// After an agentic dispatch exits 0, pull the fenced diff out of the log,
// apply it in a scratch git worktree off the cached shallow clone, push
// to the user's fork, and open a draft PR upstream. Return the URL so
// the caller can surface it in the dispatch log / UI.
//
// Why worktree (not a fresh clone): the cached clone at
// ~/.contribai/repos/<owner>__<name>/ is on the same SHA the MCP tools
// served to Claude during exploration. Applying the diff there is the
// most likely to succeed — a fresh clone off main could have drifted.
// A worktree gives us an isolated checkout on a throwaway branch while
// leaving the shared clone untouched for concurrent MCP calls.
//
// All shelling is done via execFile (no shell interpolation). gh CLI
// is used for fork + PR; git for the local mechanics. Any step that
// fails returns a diagnostic string instead of throwing — the dispatch
// already succeeded, we just couldn't ship the PR.

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gitAuthArgs } from "./git-auth";
import { GEMINI_API_BASE, GEMINI_REVIEW_MODEL } from "./models";
import { applyDiff } from "./apply-diff";
import { childEnv } from "./child-env";

const execFileAsync = promisify(execFile);

function ghBin(): string {
  if (process.env.GH_CLI && existsSync(process.env.GH_CLI)) return process.env.GH_CLI;
  return "gh";
}

function cacheRoot(): string {
  if (process.env.OPENSRCER_CACHE_DIR) return process.env.OPENSRCER_CACHE_DIR;
  return path.join(homedir(), ".contribai", "repos");
}

function cloneDir(owner: string, name: string): string {
  return path.join(cacheRoot(), `${owner}__${name}`);
}

/** Pull the first fenced block that actually contains a unified diff.
 *
 *  Scans EVERY fenced block regardless of its language tag, then keeps the
 *  first whose body has diff headers. The old version only matched fences
 *  labelled `diff`, `patch`, or nothing — which meant a preceding ```bash
 *  or ```js block (Claude emits these constantly: a repro command, the
 *  offending snippet) desynchronized the fence pairing and the real diff
 *  was never found. The dispatch then failed with "no fenced diff block
 *  found in dispatch output" despite the diff being right there. */
export function extractFirstDiff(log: string): string | null {
  // [^\n]* — consume whatever language tag is on the opening fence.
  const fenced = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of log.matchAll(fenced)) {
    const body = m[1];
    if (/^--- (?:a\/|\/dev\/null)/m.test(body) && /^\+\+\+ (?:b\/|\/dev\/null)/m.test(body)) {
      // Ensure a trailing newline — git apply refuses input without one.
      return body.endsWith("\n") ? body : body + "\n";
    }
  }
  return null;
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? childEnv(),
    maxBuffer: 20 * 1024 * 1024,
    timeout: opts.timeout ?? 60_000,
    windowsHide: true,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

async function currentGithubUser(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await run(ghBin(), ["api", "user", "--jq", ".login"], { env });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ── Base-branch resolver ────────────────────────────────────────────────
// Picks the branch to pass to `gh pr create --base` instead of relying
// on gh's implicit fallback (= repo default branch), which is wrong for
// GitFlow-style repos where the default branch receives releases while
// new PRs target `develop`.
//
// Strategy (validated empirically across trunk and GitFlow repos):
//   1. Pull recent merged PRs via gh. If ≥80% agree on one base branch,
//      that's the answer — "the repo is literally telling us where PRs
//      go here." Catches GitFlow cleanly: e.g. CodeIgniter4 has
//      default=develop and 18/20 merged PRs target develop, both agree.
//      And a GitFlow repo with default=main but 95% PRs to develop
//      would also resolve to develop.
//   2. Else fall back to the repo's default branch. Handles multi-
//      version repos (cakephp/cakephp, symfony/symfony) where PRs
//      split across 3+ release branches — pick the default because
//      the maintainer will backport / rebase if needed.
//   3. Ultimate fallback: 'main'. Only for brand-new empty repos or
//      API failures.

export type BaseBranchResolution = {
  branch: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

async function resolveBaseBranch(
  repoFull: string,
  env: NodeJS.ProcessEnv,
): Promise<BaseBranchResolution> {
  // 1. Empirical: where do merged PRs actually go?
  try {
    const { stdout } = await run(
      ghBin(),
      ["pr", "list", "--repo", repoFull, "--state", "merged",
       "--limit", "30", "--json", "baseRefName"],
      { env, timeout: 15_000 },
    );
    const prs = JSON.parse(stdout) as Array<{ baseRefName: string }>;
    // Need at least 5 data points for the percentage to be meaningful.
    // On a 4-PR sample, "3/4 = 75%" is well within noise.
    if (prs.length >= 5) {
      const counts = new Map<string, number>();
      for (const p of prs) {
        if (p.baseRefName) counts.set(p.baseRefName, (counts.get(p.baseRefName) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        const [top, topCount] = sorted[0];
        const pct = topCount / prs.length;
        if (pct >= 0.8) {
          return {
            branch: top,
            confidence: "high",
            reason: `${topCount}/${prs.length} recent merged PRs (${Math.round(pct * 100)}%) targeted '${top}'`,
          };
        }
      }
    }
  } catch {
    /* fall through — network hiccup or repo has no merged PRs */
  }

  // 2. Repo's default branch.
  try {
    const { stdout } = await run(
      ghBin(),
      ["api", `repos/${repoFull}`, "--jq", ".default_branch"],
      { env, timeout: 10_000 },
    );
    const def = stdout.trim();
    if (def) {
      return {
        branch: def,
        confidence: "medium",
        reason: "no dominant base branch in merged PR history; using repo default",
      };
    }
  } catch {
    /* fall through */
  }

  // 3. Last-ditch default.
  return { branch: "main", confidence: "low", reason: "could not query GitHub; defaulting to 'main'" };
}

/** Did the target repo's own suite run, and what did it say? Carried on
 *  the result so the caller can record it without re-parsing the log. */
export type TestOutcome = "passed" | "failed" | "skipped" | "not_run";

export type PrResult =
  | { ok: true; url: string; branch: string; base: BaseBranchResolution; tests: TestOutcome }
  | { ok: false; reason: string; tests?: TestOutcome };

export type CreatePrArgs = {
  repoFull: string;      // "owner/name" of upstream
  issueNumber: number;
  logPath: string;       // absolute path to the dispatch log
  dispatchId: string;    // used to namespace branch + worktree
  // Crucible flows: resolve a fresh installation token for this
  // (user, org) pair so the gh/git push subprocesses authenticate
  // with the right scope. Public flows omit this and gh/git pick up
  // the user's own PAT or gh-CLI keychain.
  orgCtx?: { auth0UserId: string; githubOrg: string };
  // For security findings (advisory/dependabot), the finding ID
  // (CVE or GHSA) is used instead of issue_number for branch naming.
  findingId?: string;
  // Public flows: the requesting user's GitHub OAuth token, captured when
  // the dispatch started. Required — see the env construction below.
  token?: string;
  // The requesting user's Gemini key, for the self-review gate. Passed
  // explicitly rather than read from process.env: with an allowlisted child
  // env there is no ambient GEMINI_API_KEY, and the deployer's key should
  // not be spent on a user's review anyway.
  geminiKey?: string;
};

export async function createDraftPrFromLog(args: CreatePrArgs): Promise<PrResult> {
  const [owner, name] = args.repoFull.split("/");
  if (!owner || !name) return { ok: false, reason: `invalid repo: ${args.repoFull}` };

  const logText = await readFile(args.logPath, "utf8");
  const diff = extractFirstDiff(logText);
  if (!diff) {
    return { ok: false, reason: "no fenced diff block found in dispatch output" };
  }

  const clone = cloneDir(owner, name);
  if (!existsSync(clone)) {
    return { ok: false, reason: `shallow clone missing at ${clone} (agentic run did not touch MCP tools)` };
  }

  // Allowlisted environment with exactly the credentials this run is
  // entitled to. Two things changed here:
  //
  //   1. It was `{ ...process.env }`, so every git/gh subprocess — and the
  //      repo's own `npm install && npm test`, which runs a few steps below
  //      under OPENSRCER_RUN_TESTS — saw AUTH0_SECRET, GITHUB_APP_PRIVATE_KEY
  //      and GITHUB_APP_WEBHOOK_SECRET. A postinstall script in a target repo
  //      only had to read its environment.
  //   2. gh no longer falls back to "GITHUB_TOKEN or its own keychain". On a
  //      deployed instance that keychain is the DEPLOYER's, so public-flow
  //      forks and PRs were opened from the operator's account regardless of
  //      who asked. The token is now passed in explicitly by the caller.
  //
  // GIT_TERMINAL_PROMPT=0 (set by childEnv) stops git from hanging on a
  // credential prompt in headless mode.
  const env: NodeJS.ProcessEnv = childEnv({
    GITHUB_TOKEN: args.token,
    GH_TOKEN: args.token,
    OPENSRCER_CACHE_DIR: process.env.OPENSRCER_CACHE_DIR,
  });

  // Crucible: swap in a fresh installation token if the caller passed
  // an org context. Done at PR-open time (not dispatch-start time) so a
  // long agentic run can't fail the push with an expired token.
  if (args.orgCtx) {
    const { resolveGithubToken } = await import("./crucible/tokens");
    const resolved = await resolveGithubToken(args.orgCtx);
    if (!resolved.token) {
      await appendFile(
        args.logPath,
        `[agentic-pr] token: orgCtx=${args.orgCtx.githubOrg} source=none (mapping missing)\n`,
      ).catch(() => {});
      return {
        ok: false,
        reason: `no installation token for ${args.orgCtx.githubOrg} (user not connected?)`,
      };
    }
    env.GITHUB_TOKEN = resolved.token;
    env.GH_TOKEN = resolved.token;
    // One-line audit: token source + 4-char prefix (safe to log; `ghs_`
    // identifies an installation token, `gho_`/`ghp_`/`ghu_` identify
    // user tokens). Never log the full token.
    await appendFile(
      args.logPath,
      `[agentic-pr] token: orgCtx=${args.orgCtx.githubOrg} source=${resolved.source} prefix=${resolved.token.slice(0, 4)}\n`,
    ).catch(() => {});
  }

  // Crucible (private-org) flows push directly to the upstream repo
  // using the installation token — no fork needed, no user identity
  // required. The "push remote" name differs so the commit/push/PR
  // steps below can branch on it.
  const isCrucible = Boolean(args.orgCtx);
  let ghUser: string | null = null;
  const pushRemote = isCrucible ? "origin" : "fork";

  // Crucible pushes authenticate with a one-shot header rather than a
  // tokenized origin URL. The old approach wrote the installation token
  // into the shared clone's .git/config and only restored the clean URL on
  // the success path — every failure between here and the push (worktree,
  // diff apply, gitleaks, tests, commit, push) left the credential on disk.
  const pushAuth = isCrucible ? gitAuthArgs(env.GITHUB_TOKEN) : [];

  if (!isCrucible) {
    // No inherited credential to fall back on: without the requesting
    // user's token there is nobody to attribute the fork and PR to, and
    // proceeding would mean opening it as the deployer.
    if (!args.token) {
      return {
        ok: false,
        reason:
          "no GitHub token for this dispatch — log in with GitHub so the PR " +
          "is opened from your account",
      };
    }
    ghUser = await currentGithubUser(env);
    if (!ghUser) {
      return { ok: false, reason: "gh api user failed with the session's GitHub token" };
    }

    // 1. Ensure a fork exists on the user's account.
    try {
      await run(
        ghBin(),
        ["repo", "fork", args.repoFull],
        { env, timeout: 30_000 },
      );
    } catch (e) {
      return {
        ok: false,
        reason: `gh repo fork failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 2. In the shared shallow clone, ensure a `fork` remote.
    const forkUrl = `https://github.com/${ghUser}/${name}.git`;
    try {
      await run("git", ["-C", clone, "remote", "set-url", "fork", forkUrl], { env });
    } catch {
      await run("git", ["-C", clone, "remote", "add", "fork", forkUrl], { env });
    }
  }

  // 3. Worktree + branch: isolated checkout so we don't disturb the
  //    shared clone HEAD that the MCP server keeps indexing from.
  const branchSlug = args.findingId
    ? args.findingId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)
    : `issue-${args.issueNumber}`;
  const branch = `opensrcer/${branchSlug}-${args.dispatchId.slice(-12)}`;
  const worktreeDir = path.resolve(
    process.cwd(),
    ".dispatches",
    args.dispatchId,
    "worktree",
  );
  await mkdir(path.dirname(worktreeDir), { recursive: true });
  if (existsSync(worktreeDir)) {
    // Stale worktree from a previous attempt on the same id. Purge.
    try {
      await run("git", ["-C", clone, "worktree", "remove", worktreeDir, "--force"], { env });
    } catch { /* not registered, fall through */ }
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  }
  try {
    await run(
      "git",
      ["-C", clone, "worktree", "add", "-b", branch, worktreeDir],
      { env, timeout: 30_000 },
    );
  } catch (e) {
    return {
      ok: false,
      reason: `git worktree add failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const cleanupWorktree = async () => {
    try {
      await run("git", ["-C", clone, "worktree", "remove", worktreeDir, "--force"], { env });
    } catch { /* best effort */ }
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  };

  // 4. Write the diff to disk and `git apply` it. Using --index so the
  //    changes land in both the working tree and the index, ready for
  //    commit without a separate `git add`.
  const patchPath = path.join(path.dirname(worktreeDir), "agentic.patch");
  const applied = await applyDiff(worktreeDir, diff, patchPath, {
    env,
    // Fetch recent history into the shared shallow clone so --3way can
    // reach blob parents. 50 commits covers recent-drift cases and is much
    // cheaper than --unshallow on a large repo. pushAuth carries the
    // crucible installation token when the clone is private.
    deepen: async () => {
      await run("git", [...pushAuth, "-C", clone, "fetch", "--depth=50", "origin"], {
        env,
        timeout: 60_000,
      });
      return true;
    },
  });
  if (!applied.ok) {
    await cleanupWorktree();
    return {
      ok: false,
      reason: `diff did not apply via any strategy. ${applied.errors.join(" | ").slice(0, 600)}`,
    };
  }
  await appendFile(args.logPath, `[agentic-pr] diff applied via: ${applied.tier}\n`).catch(() => {});

  // 4.4 Gemini self-review. Asks Gemini to review the patch for
  //     correctness and security before it can become a PR.
  //
  //     This is a real gate: a `critical` verdict blocks the PR. It used
  //     to log the review and continue unconditionally, which meant the
  //     "reviews its own work" step could flag a patch as actively
  //     dangerous and open the PR anyway. `concerns` still proceeds — the
  //     PR is a draft and the note is in the log for the human.
  //
  //     Set OPENSRCER_GEMINI_GATE=0 to go back to advisory-only.
  if (args.geminiKey) {
    const review = await geminiReviewDiff(diff, args.geminiKey);
    if (review) {
      await appendFile(
        args.logPath,
        `\n[gemini-review] ─────────────────────────────\n` +
          `[gemini-review] ${new Date().toISOString()}\n` +
          `[gemini-review] verdict=${review.verdict}\n` +
          `${review.text}\n`,
      ).catch(() => {});
      if (review.verdict === "critical" && process.env.OPENSRCER_GEMINI_GATE !== "0") {
        await cleanupWorktree();
        return {
          ok: false,
          reason: `gemini review returned a critical verdict — PR blocked. See [gemini-review] in the dispatch log.`,
        };
      }
    }
  }

  // 4.45 Gitleaks secret scan. Runs on every flow (public and Crucible)
  //      to prevent the agent from accidentally pushing hardcoded secrets
  //      in AI-generated code. Hard gate: any finding blocks the PR.
  {
    const { scanSecrets, formatLogBlock: fmtGitleaks } = await import("./gitleaks-scanner");
    const scanResult = await scanSecrets(worktreeDir);
    await appendFile(args.logPath, fmtGitleaks(scanResult)).catch(() => {});
    if (scanResult.status === "leaks_found") {
      await cleanupWorktree();
      return {
        ok: false,
        reason: `gitleaks found ${scanResult.findingCount} secret(s) in generated code — PR blocked`,
      };
    }
    // clean, skipped (not installed), or error: continue
  }

  // 4.5 Test runner — the thing that makes "Verified" mean something.
  //
  //   OPENSRCER_RUN_TESTS=crucible  (default) private-org flows only
  //   OPENSRCER_RUN_TESTS=all                 every flow, public included
  //   OPENSRCER_RUN_TESTS=off                 never
  //
  // Why "all" is not the default despite the README's pitch: the runner
  // executes the TARGET repo's own `npm ci && npm test` / `pytest` / etc.
  // directly on the host with no container isolation (see the header of
  // crucible/test-runner.ts). For a private repo your org already trusts
  // that's fine. For an arbitrary public repo picked off a discover scan
  // it is remote code execution by design — one malicious postinstall
  // script and the agent has handed over the box. Opt in per deployment,
  // ideally alongside CRUCIBLE_SANDBOX_DOCKER when that lands.
  //
  // Either way we ALWAYS write a [crucible-tests] marker, so the dispatch
  // record can distinguish "tests passed" from "tests never ran" instead
  // of silently showing both as success.
  let tests: TestOutcome = "not_run";
  {
    const mode = process.env.OPENSRCER_RUN_TESTS ?? "crucible";
    const shouldRun = mode === "all" || (mode === "crucible" && Boolean(args.orgCtx));

    if (shouldRun) {
      const { runTests, formatLogBlock } = await import("./crucible/test-runner");
      const result = await runTests(worktreeDir, { env });
      await appendFile(args.logPath, formatLogBlock(result)).catch(() => {});
      if (result.status === "failed" || result.status === "error") {
        await cleanupWorktree();
        return {
          ok: false,
          tests: "failed",
          reason: `tests ${result.status}: ${result.reason ?? result.command ?? "unknown"}`,
        };
      }
      tests = result.status === "passed" ? "passed" : "skipped";
    } else {
      await appendFile(
        args.logPath,
        `\n[crucible-tests] status=not_run reason=OPENSRCER_RUN_TESTS=${mode}` +
          `${args.orgCtx ? "" : " (public flow)"} — patch is UNVERIFIED\n`,
      ).catch(() => {});
    }
  }

  // 5. Commit with the user's identity (matches HANDOFF's "Commits
  //    always use rahulp7801" rule; env values let us override).
  //
  // Commit message is just a clean subject line — no "generated by"
  // trailer, no exploration log reference, no co-author. The upstream
  // maintainer sees a regular contribution; traceability to the
  // dispatch lives on the local dashboard.
  const authorName = process.env.OPENSRCER_COMMIT_NAME ?? "rahulp7801";
  const authorEmail =
    process.env.OPENSRCER_COMMIT_EMAIL ?? "76501505+rahulp7801@users.noreply.github.com";
  // Use Claude's extracted PR title as the commit message when available —
  // much more descriptive than the old generic `Fix #N: path`. Build it
  // early so the commit step below can use it.
  const { title: prTitle, body: prBody } = buildPrContent(
    args.issueNumber,
    args.dispatchId,
    logText,
    diff,
  );
  const commitMsg = prTitle;
  try {
    await run(
      "git",
      [
        "-C", worktreeDir,
        "-c", `user.name=${authorName}`,
        "-c", `user.email=${authorEmail}`,
        "commit",
        "-m", commitMsg,
      ],
      { env },
    );
  } catch (e) {
    await cleanupWorktree();
    return {
      ok: false,
      reason: `git commit failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 6. Push branch. `pushAuth` is empty for public flows (gh/git pick up
  //    the user's own credentials) and a one-shot auth header for crucible.
  try {
    await run("git", [...pushAuth, "-C", worktreeDir, "push", "-u", pushRemote, branch], {
      env,
      timeout: 90_000,
    });
  } catch (e) {
    await cleanupWorktree();
    return {
      ok: false,
      reason: `git push to ${pushRemote} failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Resolve the PR target branch BEFORE opening the PR. Passing an
  // explicit --base avoids gh's implicit "inherit repo default" which
  // is wrong for GitFlow-style repos.
  const baseRes = await resolveBaseBranch(args.repoFull, env);

  let prUrl: string;
  if (isCrucible) {
    // Crucible: open PR via GitHub API with the installation token.
    // head is just the branch name (same repo, not a fork).
    try {
      const res = await fetch(
        `https://api.github.com/repos/${args.repoFull}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: prTitle,
            body: prBody,
            head: branch,
            base: baseRes.branch,
            draft: true,
          }),
        },
      );
      if (!res.ok) {
        const errBody = await res.text();
        await cleanupWorktree();
        return {
          ok: false,
          reason: `GitHub API PR create failed: ${res.status} ${errBody.slice(0, 300)}`,
        };
      }
      const prJson = (await res.json()) as { html_url: string };
      prUrl = prJson.html_url;
    } catch (e) {
      await cleanupWorktree();
      return {
        ok: false,
        reason: `GitHub API PR create failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else {
    try {
      const { stdout } = await run(
        ghBin(),
        [
          "pr", "create",
          "--repo", args.repoFull,
          "--head", `${ghUser}:${branch}`,
          "--base", baseRes.branch,
          "--title", prTitle,
          "--body", prBody,
          "--draft",
        ],
        { env, timeout: 30_000 },
      );
      prUrl = stdout.trim().split("\n").pop() || "";
    } catch (e) {
      await cleanupWorktree();
      return {
        ok: false,
        reason: `gh pr create failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // 7. Worktree cleanup on success too — the branch lives on the fork now.
  await cleanupWorktree();
  if (!prUrl) return { ok: false, reason: "gh pr create returned no URL" };
  return { ok: true, url: prUrl, branch, base: baseRes, tests };
}

// ── PR title/body assembly ─────────────────────────────────────────────
// The dispatch log contains Claude's structured response with sections
// (## Diagnosis, ## Risk / Test, ## PR title, ## PR body). Pull them out
// and use them directly as the PR title/body instead of the old static
// "generated by opensrcer" boilerplate. Fall back to sensible defaults
// when sections are missing (older logs, partial responses, etc.).

function extractSection(log: string, headingAlt: string): string | null {
  // headingAlt is a regex alternation like 'Diagnosis|Analysis'.
  // Section ends at the next ## heading, a fenced block, the dispatcher
  // separator lines, or end-of-string.
  const re = new RegExp(
    `^##\\s+(?:${headingAlt})\\s*\\n([\\s\\S]+?)(?=\\n##\\s|\\n\\[agentic-dispatcher\\]|\\n\\[agentic-pr\\]|\\n\`\`\`(?:diff|patch)|$)`,
    "im",
  );
  return re.exec(log)?.[1].trim() ?? null;
}

function firstNonEmptyLine(s: string | null): string | null {
  if (!s) return null;
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[#>*\-`\s]+/, "");
    if (trimmed) return trimmed;
  }
  return null;
}

type PrContent = { title: string; body: string };

export function buildPrContent(
  issueNumber: number,
  dispatchId: string,
  logText: string,
  diff: string,
): PrContent {
  const titleSection = extractSection(logText, "PR title|Suggested PR title|Suggested title|Title");
  const bodySection = extractSection(logText, "PR body|PR description|Description");
  const diagnosis = extractSection(logText, "Diagnosis|Analysis|Root cause|Problem");
  const risk = extractSection(logText, "Risk\\s*/\\s*Test|Risk / test|Risk and test|Risk & test|Testing|Test notes|Risk / Testing");
  const conventions = extractSection(logText, "Conventions|Contribution guide|Contributing");

  // ── Title ────
  // Prefer Claude's explicit "## PR title" line. Fall back to a concise
  // default. Strip any markdown the model may have wrapped it in.
  let title = firstNonEmptyLine(titleSection) ?? (issueNumber > 0 ? `fix: resolve #${issueNumber}` : `fix: remediate security vulnerability`);
  // Safety: titles over ~90 chars are usually a sign Claude wrote the
  // whole first paragraph on one line. Truncate at the first period or
  // at 85 chars.
  if (title.length > 90) {
    const firstSentence = title.split(/(?<=\.)\s/)[0];
    title = firstSentence.length <= 90 ? firstSentence : title.slice(0, 85).replace(/\s\S*$/, "") + "…";
  }

  // ── Body ────
  // Prefer Claude's full "## PR body". If missing, assemble from the
  // other sections. Either way, ensure "Fixes #N" is present so the
  // issue auto-closes on merge.
  let body: string;
  if (bodySection && bodySection.length > 40) {
    body = bodySection;
    if (issueNumber > 0 && !/\b(?:fixes|closes|resolves)\s+#\d+/i.test(body)) {
      body = `Fixes #${issueNumber}\n\n${body}`;
    }
  } else {
    const files = [...diff.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1]);
    const parts: string[] = issueNumber > 0 ? [`Fixes #${issueNumber}.`] : [`Security vulnerability remediation.`];
    if (diagnosis) parts.push(`## Summary\n\n${diagnosis}`);
    if (files.length > 0) {
      parts.push(
        `## Files changed\n\n${files.map((f) => `- \`${f}\``).join("\n")}`,
      );
    }
    if (risk) parts.push(`## Test plan\n\n${risk}`);
    if (conventions && !/^no contribution guide/i.test(conventions)) {
      parts.push(
        `<details><summary>Contribution guide notes</summary>\n\n${conventions}\n\n</details>`,
      );
    }
    body = parts.join("\n\n");
  }

  return { title, body };
}

// ── Gemini self-review ────────────────────────────────────────────────
// Calls Gemini to review a diff for correctness and security issues.
// Uses the REST API directly to avoid adding an SDK dependency.
//
// Returns null on any transport failure (rate limit, quota, network). A
// review we could not obtain must never block a PR — only a review that
// actually came back and said "critical" does.

export type GeminiVerdict = "clean" | "concerns" | "critical";

export type GeminiReview = { verdict: GeminiVerdict; text: string };

/** Pull the trailing `VERDICT: x` line out of the model's response.
 *  Defaults to "concerns" when the line is missing or unparseable —
 *  neither silently clean nor a PR-blocking critical. */
export function parseGeminiVerdict(text: string): GeminiVerdict {
  const m = /^\s*VERDICT:\s*(clean|concerns|critical)\s*$/im.exec(text);
  return (m?.[1].toLowerCase() as GeminiVerdict) ?? "concerns";
}

async function geminiReviewDiff(diff: string, apiKey: string): Promise<GeminiReview | null> {
  // Truncate very large diffs to stay within Gemini's context window.
  const truncated = diff.length > 30_000 ? diff.slice(0, 30_000) + "\n\n... (truncated)" : diff;

  const prompt = [
    "You are a senior security engineer reviewing a patch. The patch was generated by an AI agent to fix a bug or remediate a vulnerability.",
    "",
    "Review the diff below for:",
    "1. **Correctness** — does it actually fix what it claims to fix?",
    "2. **Security** — does it introduce any new vulnerabilities (injection, auth bypass, etc.)?",
    "3. **Completeness** — are there obvious gaps (missing null checks, untested edge cases)?",
    "",
    "Be concise. 3-8 bullet points max. If the patch looks clean, say so in one line.",
    "",
    "Then end your response with exactly one final line, nothing after it:",
    "  VERDICT: clean      — safe to open as a draft PR",
    "  VERDICT: concerns   — worth a human look, but not dangerous",
    "  VERDICT: critical   — actively wrong or insecure; must not be opened",
    "Reserve `critical` for patches that are broken or introduce a vulnerability.",
    "Style nits and missing tests are `concerns`, not `critical`.",
    "",
    "```diff",
    truncated,
    "```",
  ].join("\n");

  try {
    // Key goes in a header, not the query string. A `?key=` lands in proxy
    // access logs, browser-style referrer chains and any intermediary that
    // records URLs; the header does not.
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_REVIEW_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
      },
    );
    if (!res.ok) {
      // Rate limit or quota — skip silently, don't block the PR flow.
      return null;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return { verdict: parseGeminiVerdict(text), text };
  } catch {
    // Network error, timeout, etc. — a review we couldn't get is not a veto.
    return null;
  }
}
