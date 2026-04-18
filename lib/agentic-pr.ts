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

/** Pull the first fenced `diff` / `patch` block out of a log blob.
 *  Tolerates the common forms Claude produces: ```diff … ```,
 *  ```patch … ```, or a bare ``` block that starts with `--- a/`. */
export function extractFirstDiff(log: string): string | null {
  const fenced = /```(?:diff|patch|)\s*\n([\s\S]*?)```/g;
  for (const m of log.matchAll(fenced)) {
    const body = m[1];
    if (/^--- (?:a\/|\/dev\/null)/m.test(body) && /^\+\+\+ b\//m.test(body)) {
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
    env: opts.env ?? process.env,
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

export type PrResult =
  | { ok: true; url: string; branch: string; base: BaseBranchResolution }
  | { ok: false; reason: string };

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

  const env: NodeJS.ProcessEnv = { ...process.env };
  // gh uses GITHUB_TOKEN or its own keychain; both are fine. GIT_TERMINAL_PROMPT=0
  // stops git from hanging on a credential prompt in headless mode.
  env.GIT_TERMINAL_PROMPT = "0";

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

  if (isCrucible) {
    // Temporarily set origin URL with the installation token so git push
    // authenticates. Saved and restored after push to avoid leaving
    // secrets in the clone's git config.
    const tokenUrl = `https://x-access-token:${env.GITHUB_TOKEN}@github.com/${args.repoFull}.git`;
    try {
      await run("git", ["-C", clone, "remote", "set-url", "origin", tokenUrl], { env });
    } catch (e) {
      return { ok: false, reason: `set origin URL failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    ghUser = await currentGithubUser(env);
    if (!ghUser) {
      return { ok: false, reason: "gh CLI not authenticated (gh api user failed)" };
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
  const branch = `opensrcer/issue-${args.issueNumber}-${args.dispatchId.slice(-12)}`;
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
  await writeFile(patchPath, diff);
  // Four-tier apply ladder. LLM diffs fail in predictable ways; each
  // tier targets a specific class of failure:
  //
  //   1. strict           — clean baseline
  //   2. --ignore-whitespace   — catches paraphrased context lines where
  //                              Claude subtly altered spacing/tabs
  //   3. deepen + --3way       — fetches blob history into the shallow
  //                              clone so 3-way merge can fuzz-match
  //                              when context has drifted lightly
  //   4. deepen + --3way + --ignore-whitespace — combined last resort
  //
  // Each step logs its own failure mode. If all four fail we give up
  // with the last error, since the diff is beyond any reasonable
  // auto-correction.
  const applyBase = ["-C", worktreeDir, "apply", "--index", "--recount", "--whitespace=nowarn"];
  let lastErr: unknown = null;
  const applyTiers: Array<{ name: string; args: string[]; deepen?: boolean }> = [
    { name: "strict",                            args: [...applyBase, patchPath] },
    { name: "ignore-whitespace",                 args: [...applyBase, "--ignore-whitespace", patchPath] },
    { name: "3way (deepened)",                   args: [...applyBase, "--3way", patchPath], deepen: true },
    { name: "3way + ignore-whitespace (deepened)", args: [...applyBase, "--3way", "--ignore-whitespace", patchPath], deepen: true },
  ];
  let deepened = false;
  let success = false;
  for (const tier of applyTiers) {
    if (tier.deepen && !deepened) {
      // Fetch recent history into the shared shallow clone so --3way can
      // reach blob parents. 50 commits is enough for recent-drift cases
      // and much cheaper than --unshallow on a large repo.
      try {
        await run("git", ["-C", clone, "fetch", "--depth=50", "origin"], { env, timeout: 60_000 });
        deepened = true;
      } catch {
        // Fetch failed (offline, fork issues, …). Skip 3way tiers.
        break;
      }
    }
    try {
      await run("git", tier.args, { env });
      success = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!success) {
    // Final tier: GNU `patch --fuzz=3`. `git apply` is strict to a fault —
    // it bails on even a 1-line offset because Claude wrote the hunk
    // header with the wrong starting line. GNU patch slides hunks to find
    // their match; observed to apply every LLM-drift case tested. If this
    // also fails, the diff is genuinely unusable.
    try {
      await run(
        "patch",
        ["-p1", "--fuzz=3", "-i", patchPath, "--no-backup-if-mismatch"],
        { env, cwd: worktreeDir },
      );
      // GNU patch writes to the working tree but not the index. Stage
      // the files it touched so the subsequent commit picks them up.
      const touched = [...diff.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1]);
      for (const p of touched) {
        await run("git", ["-C", worktreeDir, "add", "--", p], { env });
      }
      success = true;
    } catch (e) {
      await cleanupWorktree();
      const primary = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const fallback = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: `diff did not apply via any strategy (git apply x4, GNU patch --fuzz=3). git: ${primary.slice(0, 200)}. patch: ${fallback.slice(0, 200)}`,
      };
    }
  }

  // 4.5 Crucible sandbox test runner. Only runs for private-org flows
  //     (orgCtx set). Public flows skip entirely — the existing PAT
  //     path has no test-gating semantics and shouldn't block on
  //     install-time failures for random public repos. The runner is
  //     best-effort: a "skipped" result (no recognized ecosystem) still
  //     permits the PR to open, but we annotate the log so the UI can
  //     show "tests not run" rather than "verified".
  if (args.orgCtx) {
    const { runTests, formatLogBlock } = await import("./crucible/test-runner");
    const result = await runTests(worktreeDir, { env });
    await appendFile(args.logPath, formatLogBlock(result)).catch(() => {});
    if (result.status === "failed" || result.status === "error") {
      await cleanupWorktree();
      return {
        ok: false,
        reason: `tests ${result.status}: ${result.reason ?? result.command ?? "unknown"}`,
      };
    }
    // passed or skipped: continue to commit + PR.
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

  // 6. Push branch.
  try {
    await run("git", ["-C", worktreeDir, "push", "-u", pushRemote, branch], {
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

  // Crucible: restore origin URL to the public (non-tokened) form so the
  // installation token doesn't persist in the clone's git config.
  if (isCrucible) {
    const cleanUrl = `https://github.com/${args.repoFull}.git`;
    await run("git", ["-C", clone, "remote", "set-url", "origin", cleanUrl], { env }).catch(() => {});
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
            body: prBody + `\n\n---\n*Patch generated by [opensrcer crucible](https://github.com/rahulp7801/opensrcer) · dispatch \`${args.dispatchId}\`*`,
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
  return { ok: true, url: prUrl, branch, base: baseRes };
}

/** First file path touched by the diff, for the commit subject. */
function diffFirstPath(diff: string): string | null {
  const m = /^\+\+\+ b\/(\S+)/m.exec(diff);
  return m ? m[1] : null;
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

function buildPrContent(
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
  let title = firstNonEmptyLine(titleSection) ?? `fix: resolve #${issueNumber}`;
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
    if (!/\b(?:fixes|closes|resolves)\s+#\d+/i.test(body)) {
      body = `Fixes #${issueNumber}\n\n${body}`;
    }
  } else {
    const files = [...diff.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1]);
    const parts: string[] = [`Fixes #${issueNumber}.`];
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
