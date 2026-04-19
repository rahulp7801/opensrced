// Agentic solve path — spawns `claude -p` headless with the opensrcer MCP
// server configured. Instead of calling contribai.exe (deterministic
// pre-attach + Sonnet one-shot), Claude drives exploration itself by
// calling list_files/read_file/grep/find_definition/find_references against
// the cached shallow clone until it has enough context to propose a fix.
//
// Why split this out from `lib/dispatcher.ts`: that file is hard-wired to
// CONTRIBAI_BIN and the target/solve/hunt argument shape. Rather than
// sprinkle if-agentic branches through it, the agentic flow reuses the
// dispatch log format + registry indirectly (via the same .dispatches/<id>
// layout) but owns its own spawn.
//
// v2 scope: the agent's output goes to the dispatch log as plain text
// (markdown with a unified-diff fenced block is what Claude tends to
// produce). The draft-preview → approve-PR pipeline is NOT wired for
// agentic mode yet — the user reads the log, decides, and either applies
// the diff manually or re-runs the deterministic path. Auto-PR for agentic
// is a v2.1 follow-up.

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Dispatch } from "./dispatcher";
import { createDraftPrFromLog } from "./agentic-pr";

const DISPATCH_DIR = join(process.cwd(), ".dispatches");

// Parse stream-json output from Claude, write readable text to the log,
// and return the total cost when the result event arrives.
function pipeStreamJson(
  stdout: import("node:stream").Readable,
  out: import("node:fs").WriteStream,
): void {
  let buf = "";
  stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        // Assistant text content
        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text" && block.text) {
              out.write(block.text);
            }
          }
        }
        // Final result — write cost to log
        if (evt.type === "result") {
          if (typeof evt.total_cost_usd === "number") {
            out.write(`\n[agentic-dispatcher] total_cost_usd=${evt.total_cost_usd.toFixed(6)}\n`);
          }
        }
      } catch {
        // Not JSON — write raw (shouldn't happen with stream-json)
        out.write(line + "\n");
      }
    }
  });
}
const MCP_CONFIG = join(process.cwd(), ".mcp.json");

function ensureDir() {
  if (!existsSync(DISPATCH_DIR)) mkdirSync(DISPATCH_DIR, { recursive: true });
}

function fetchGithubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = process.env.GH_CLI;
  if (!gh || !existsSync(gh)) return undefined;
  try {
    return (
      execFileSync(gh, ["auth", "token"], { encoding: "utf8", timeout: 4000 }).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

function fetchIssueBody(repoFull: string, issueNumber: number): string {
  const gh = process.env.GH_CLI;
  if (!gh || !existsSync(gh)) {
    return `(gh CLI not available; body could not be fetched for ${repoFull}#${issueNumber})`;
  }
  try {
    const raw = execFileSync(
      gh,
      ["issue", "view", String(issueNumber), "--repo", repoFull, "--json", "title,body,labels,url"],
      { encoding: "utf8", timeout: 8000, maxBuffer: 5 * 1024 * 1024 },
    );
    const parsed = JSON.parse(raw) as {
      title: string;
      body: string;
      labels: Array<{ name: string }>;
      url: string;
    };
    const labels = (parsed.labels ?? []).map((l) => l.name).join(", ") || "(none)";
    return `# ${parsed.title}\n\nURL: ${parsed.url}\nLabels: ${labels}\n\n${parsed.body ?? "(empty body)"}`;
  } catch (e) {
    return `(failed to fetch issue body: ${e instanceof Error ? e.message : String(e)})`;
  }
}

export type FindingInput = {
  id: string;
  kind: string;
  summary?: string;
  description?: string;
  cve_id?: string;
  affected_package?: string;
  affected_versions?: string;
};

function buildFindingPrompt(repoFull: string, finding: FindingInput): string {
  const parts = [
    `You are remediating a security vulnerability in the GitHub repository \`${repoFull}\`.`,
    ``,
    `## The vulnerability`,
    ``,
    `**Type:** ${finding.kind}`,
    finding.id ? `**ID:** ${finding.id}` : null,
    finding.cve_id ? `**CVE:** ${finding.cve_id}` : null,
    finding.affected_package ? `**Affected package:** ${finding.affected_package}` : null,
    finding.affected_versions ? `**Vulnerable versions:** ${finding.affected_versions}` : null,
    ``,
    `**Summary:** ${finding.summary ?? "(no summary)"}`,
    ``,
    finding.description ? `**Details:**\n\n${finding.description}` : null,
    ``,
    `## Your tools`,
    ``,
    `The MCP server \`opensrcer-repo-tools\` is configured. Every tool takes \`repo: "${repoFull}"\`. Use them to explore the codebase; the repo is shallow-cloned and cached locally.`,
    ``,
    `- \`repo_info\` — orient on an unfamiliar repo first.`,
    `- \`list_files\` — directory/glob listing.`,
    `- \`read_file\` — read a specific file (pass \`line_start\`/\`line_end\` for large files).`,
    `- \`grep\` — regex search.`,
    `- \`find_definition\` — heuristic def-site lookup for a symbol.`,
    `- \`find_references\` — every mention of a symbol, with per-file counts.`,
    ``,
    `## Your task`,
    ``,
    `1. Find the dependency or code path affected by this vulnerability.`,
    `2. Determine the fix — usually a version bump in a manifest file (package.json, Cargo.toml, requirements.txt, go.mod, etc.), but may require a code change if the vulnerable API is used directly.`,
    `3. Check that the fix doesn't break compatibility — read how the package is imported/used.`,
    ``,
    `## What to produce`,
    ``,
    `Structure your final response with these section headings **exactly**:`,
    ``,
    `1. \`## Diagnosis\` — what the vulnerability is, which file/line is affected, and what the fix is.`,
    `2. A fenced \`\`\`diff block with the patch. Use standard \`--- a/path\` / \`+++ b/path\` headers.`,
    `3. \`## Risk / Test\` — what could break, what the user should verify.`,
    `4. \`## PR title\` — one line, under 72 chars. E.g. "fix: bump lodash to 4.17.21 (CVE-2021-23337)"`,
    `5. \`## PR body\` — markdown body for the PR. Include a summary, what changed and why, and \`Fixes ${finding.cve_id ?? finding.id}\`.`,
    ``,
    `Rules:`,
    `- Do not fabricate file paths. Verify every path via \`list_files\` or \`read_file\` first.`,
    `- Prefer the smallest change that fixes the vulnerability.`,
    `- If the fix requires a major version bump that would break the codebase, say so and stop.`,
  ];
  return parts.filter((l) => l !== null).join("\n");
}

function buildPrompt(repoFull: string, issueNumber: number, issueBody: string): string {
  // The system/user prompt drives the agent through the MCP tools. We lean
  // on Claude's own judgment for exploration depth rather than prescribing a
  // fixed plan — the whole point of v2 is that it can decide when it has
  // enough context.
  return [
    `You are fixing issue #${issueNumber} in the GitHub repository \`${repoFull}\`.`,
    ``,
    `## The issue`,
    ``,
    issueBody,
    ``,
    `## Your tools`,
    ``,
    `The MCP server \`opensrcer-repo-tools\` is configured. Every tool takes \`repo: "${repoFull}"\`. Use them to explore the codebase; the repo is shallow-cloned and cached locally.`,
    ``,
    `- \`repo_info\` — orient on an unfamiliar repo first.`,
    `- \`list_files\` — directory/glob listing.`,
    `- \`read_file\` — read a specific file (pass \`line_start\`/\`line_end\` for large files).`,
    `- \`grep\` — regex search.`,
    `- \`find_definition\` — heuristic def-site lookup for a symbol.`,
    `- \`find_references\` — every mention of a symbol, with per-file counts.`,
    ``,
    `## Required first step — read the contribution guide`,
    ``,
    `Before proposing any fix, look for and read contribution guidelines. Call \`list_files\` with globs like \`CONTRIBUTING*\`, \`.github/**\`, \`PULL_REQUEST_TEMPLATE*\`, \`docs/contributing*\`. When any exist, \`read_file\` them and note:`,
    ``,
    `- **Target branch** — some repos require PRs against \`develop\` / \`next\` / \`main\` specifically.`,
    `- **PR title format** — Conventional Commits (\`fix:\`, \`feat:\`), issue refs (\`Fixes #N\`), subject line limits.`,
    `- **Commit message conventions** — sign-off requirement (\`Signed-off-by\`), DCO, CLA hints.`,
    `- **Required tests / checks** — "add a test", "run \`make lint\`", linters that must pass.`,
    `- **Style / formatting** — line length, import order, formatter (\`black\`, \`prettier\`, \`ruff\`, \`gofmt\`).`,
    `- **Out-of-scope scope notes** — "keep PRs small", "one fix per PR".`,
    ``,
    `If no guide exists, say so briefly and proceed. Do not fabricate conventions.`,
    ``,
    `## What to produce`,
    ``,
    `Explore as much as you need, then emit the fix. Structure your final response with these section headings **exactly** — the dispatcher parses them to build the PR:`,
    ``,
    `1. \`## Conventions\` — what CONTRIBUTING/PR-template require (2–5 bullets), or "No contribution guide found". If the guide names a non-default target branch, say so explicitly so the user knows to override the auto-PR base.`,
    `2. \`## Diagnosis\` — 2–4 sentences on the root cause, citing file:line.`,
    `3. A fenced \`\`\`diff block with the patch. Use standard \`--- a/path\` / \`+++ b/path\` headers. If the guide requires tests, include the new/updated test file in the diff.`,
    `4. \`## Risk / Test\` — which existing call sites or tests you checked, whether lint/tests would pass, anything the user should verify before marking Ready for review.`,
    `5. \`## PR title\` — one line, under 72 chars. Start with the repo's conventional prefix if CONTRIBUTING requires it (\`fix: \`, \`feat: \`, \`[Component] \`, etc.); otherwise plain imperative mood. This is what the PR title will be — write it as a maintainer would want to see it.`,
    `6. \`## PR body\` — a multi-paragraph markdown body for the PR. Include: a one-line summary, the root cause (can reuse your Diagnosis), what the patch changes and why, a Test plan (can reuse Risk / Test), and \`Fixes #N\` (or whatever close-keyword CONTRIBUTING prefers) so the issue auto-closes on merge. Match the tone of any PULL_REQUEST_TEMPLATE you saw. No fenced diff here — the diff above is the patch itself.`,
    ``,
    `Rules:`,
    `- Do not fabricate file paths. Verify every path via \`list_files\` or \`read_file\` first.`,
    `- Prefer the smallest change that fixes the issue. Don't refactor surrounding code.`,
    `- If the fix would touch more than 5 files or you can't locate the root cause with confidence, say so explicitly and stop — a human should drive that one.`,
    `- If CONTRIBUTING demands a test and you can't write one confidently (missing fixtures, unclear harness), say so and stop — shipping a PR that the repo's own CI will reject is worse than shipping nothing.`,
  ].join("\n");
}

export type StartAgenticOpts = {
  // Installation token for private-org flows (already resolved by the
  // caller via lib/crucible/tokens.ts::resolveGithubToken).
  token?: string;
  // Org context carried through so the post-run PR-open hook can
  // re-resolve a fresh installation token if the first one aged out
  // during the agentic run.
  orgCtx?: { auth0UserId: string; githubOrg: string };
  // User-provided API keys (from encrypted cookie).
  anthropicKey?: string;
  geminiKey?: string;
  // Hard cap on Anthropic API spend for this dispatch.
  maxSpendUsd?: number;
};

export function startAgenticDispatch(
  repoUrl: string,
  issueNumber: number,
  opts: StartAgenticOpts = {},
): Dispatch {
  if (!existsSync(MCP_CONFIG)) {
    throw new Error(`Missing ${MCP_CONFIG} — build the MCP server first (cd mcp-server && npm run build).`);
  }

  // Parse "owner/name" from either a URL or a bare slug.
  const m = /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
    repoUrl.trim().replace(/\.git$/i, ""),
  );
  const owner = m?.[1] ?? m?.[3];
  const name = m?.[2] ?? m?.[4];
  if (!owner || !name) throw new Error(`Unrecognized repo URL: ${repoUrl}`);
  const repoFull = `${owner}/${name}`;

  ensureDir();
  const id = `d_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${randomUUID().slice(0, 6)}`;
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  const out = createWriteStream(logPath);

  const issueBody = fetchIssueBody(repoFull, issueNumber);
  const prompt = buildPrompt(repoFull, issueNumber, issueBody);

  // Runaway guard rails:
  //   --max-budget-usd — hard cap on total LLM spend for this one invocation.
  //     Claude exits cleanly when the cap is reached. Default $2 is a
  //     realistic ceiling for leaf/cross-file issues; override via env for
  //     harder repos. Only works under --print (we're in -p mode already).
  //   wall-clock timeout — setTimeout below kills the whole process tree if
  //     Claude is still alive after N minutes. Covers the case where the
  //     model loops on tool calls without ever emitting final output.
  const budgetUsd = opts.maxSpendUsd ?? Number(process.env.OPENSRCER_AGENTIC_BUDGET_USD ?? "2");
  // 30 min default. Was 15 — bumped after a real dispatch on
  // splx-ai/agentic-radar#127 hit the cap while Claude was still writing
  // a complete response. Override via OPENSRCER_AGENTIC_TIMEOUT_MS.
  const timeoutMs = Number(process.env.OPENSRCER_AGENTIC_TIMEOUT_MS ?? String(30 * 60 * 1000));

  // bypassPermissions so the MCP tools can run without interactive approval
  // in headless mode. strict-mcp-config keeps Claude from picking up any
  // user-global MCP servers — we want exactly our toolbelt.
  const args = [
    "-p",
    prompt,
    "--mcp-config",
    MCP_CONFIG,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(budgetUsd),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  const token = opts.token ?? fetchGithubToken();
  if (token) env.GITHUB_TOKEN = token;
  if (opts.anthropicKey) env.ANTHROPIC_API_KEY = opts.anthropicKey;
  if (opts.geminiKey) env.GEMINI_API_KEY = opts.geminiKey;

  out.write(
    `[agentic-dispatcher] ${new Date().toISOString()}\n` +
      `[agentic-dispatcher] repo: ${repoFull}  issue: #${issueNumber}\n` +
      `[agentic-dispatcher] bin: claude (-p headless, MCP: ${MCP_CONFIG})\n` +
      `[agentic-dispatcher] env: ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY ? "(present)" : "(missing — claude will use its own auth)"} · GITHUB_TOKEN=${token ? "(present)" : "(missing)"}\n` +
      `[agentic-dispatcher] guardrails: --max-budget-usd=${budgetUsd} · timeout=${Math.round(timeoutMs / 1000)}s\n` +
      `[agentic-dispatcher] ─────────────────────────────\n`,
  );

  const child = spawn("claude", args, { env, windowsHide: true });

  // Wall-clock kill-switch. Fires only if claude is still alive at the
  // deadline; cleared when the close handler runs. `taskkill /T` on Windows
  // takes down the whole tree (claude + any MCP-server children).
  //
  // Writing a marker line to the log the moment the timer fires matters
  // because Node's `close` event can lag the actual kill by many minutes
  // on Windows when a grandchild holds the inherited stdio pipe open. The
  // "exited at" line only lands when that pipe finally closes — without
  // this marker, the user sees a 90-min gap and can't tell when we pulled
  // the plug.
  let killedByTimeout = false;
  const timeoutHandle = setTimeout(() => {
    if (!child.killed && child.pid) {
      killedByTimeout = true;
      const killedAt = new Date().toISOString();
      try {
        out.write(
          `\n[agentic-dispatcher] ─────────────────────────────\n` +
            `[agentic-dispatcher] wall-clock timeout (${Math.round(timeoutMs / 1000)}s) hit at ${killedAt}\n` +
            `[agentic-dispatcher] issuing taskkill on PID ${child.pid} + tree; Node 'close' event may lag if a grandchild holds the stdio pipe\n`,
        );
      } catch {
        /* stream may be half-closed; nothing we can do */
      }
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "pipe" });
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }
  }, timeoutMs);

  const dispatch: Dispatch = {
    id,
    repo_url: repoUrl,
    mode: "agentic",
    // Despite auto-PR running on clean exit (v2.2), dry_run=true is still
    // accurate semantically — the *claude* invocation never pushes. Auto-PR
    // is a separate post-hook; keeping dry_run=true keeps the existing UI
    // chip consistent.
    dry_run: true,
    issue_number: issueNumber,
    started_at: new Date().toISOString(),
    status: "running",
    pid: child.pid,
    log_path: logPath,
  };

  pipeStreamJson(child.stdout, out);
  child.stderr.on("data", () => {}); // swallow stderr (MCP startup noise)
  child.on("close", (code, signal) => {
    clearTimeout(timeoutHandle);
    dispatch.ended_at = new Date().toISOString();
    dispatch.exit_code = code ?? undefined;
    const wasKilled = signal === "SIGKILL" || signal === "SIGTERM" || killedByTimeout;
    dispatch.status = wasKilled
      ? "killed"
      : code === 0
        ? "succeeded"
        : "failed";
    out.write(
      `\n[agentic-dispatcher] ─────────────────────────────\n` +
        `[agentic-dispatcher] exited at ${dispatch.ended_at} · status=${dispatch.status} · exit=${code ?? "n/a"}` +
        (killedByTimeout ? " (killed by wall-clock timeout)" : "") +
        `\n`,
    );
    out.end();

    // Auto-PR on clean exit. Runs detached — we can't block the close
    // handler, and the dispatch is already reported as succeeded. On
    // success we append the PR URL to the log; on failure we append the
    // diagnostic so the user can fix and rerun.
    if (
      !wasKilled &&
      code === 0 &&
      process.env.OPENSRCER_AGENTIC_AUTO_PR !== "0"
    ) {
      void (async () => {
        // Small delay so the close handler's write flushes before we append.
        await new Promise((r) => setTimeout(r, 250));
        const header =
          `\n[agentic-pr] ─────────────────────────────\n` +
          `[agentic-pr] starting auto-PR at ${new Date().toISOString()}\n`;
        await appendFile(logPath, header).catch(() => {});
        try {
          const result = await createDraftPrFromLog({
            repoFull,
            issueNumber,
            logPath,
            dispatchId: id,
            orgCtx: opts.orgCtx,
          });
          const line = result.ok
            ? `[agentic-pr] opened draft PR: ${result.url}\n` +
              `[agentic-pr] head: ${result.branch}  →  base: ${result.base.branch} (${result.base.confidence} confidence — ${result.base.reason})\n`
            : `[agentic-pr] skipped: ${result.reason}\n`;
          await appendFile(logPath, line).catch(() => {});
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          await appendFile(logPath, `[agentic-pr] unexpected error: ${msg}\n`).catch(() => {});
        }
      })();
    }
  });
  child.on("error", (err) => {
    dispatch.ended_at = new Date().toISOString();
    dispatch.status = "failed";
    out.write(`\n[agentic-dispatcher] spawn error: ${err.message}\n`);
    out.end();
  });

  return dispatch;
}

// ── Security-finding dispatch ─────────────────────────────────────────
// Same spawn mechanics as startAgenticDispatch but takes a FindingInput
// (advisory / dependabot alert) instead of an issue number. The prompt
// is tailored for vulnerability remediation rather than bug fixing.

export function startFindingDispatch(
  repoUrl: string,
  finding: FindingInput,
  opts: StartAgenticOpts = {},
): Dispatch {
  if (!existsSync(MCP_CONFIG)) {
    throw new Error(`Missing ${MCP_CONFIG} — build the MCP server first (cd mcp-server && npm run build).`);
  }

  const m = /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
    repoUrl.trim().replace(/\.git$/i, ""),
  );
  const owner = m?.[1] ?? m?.[3];
  const name = m?.[2] ?? m?.[4];
  if (!owner || !name) throw new Error(`Unrecognized repo URL: ${repoUrl}`);
  const repoFull = `${owner}/${name}`;

  ensureDir();
  const id = `d_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${randomUUID().slice(0, 6)}`;
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  const out = createWriteStream(logPath);

  const prompt = buildFindingPrompt(repoFull, finding);

  const budgetUsd = opts.maxSpendUsd ?? Number(process.env.OPENSRCER_AGENTIC_BUDGET_USD ?? "2");
  const timeoutMs = Number(process.env.OPENSRCER_AGENTIC_TIMEOUT_MS ?? String(30 * 60 * 1000));

  const args = [
    "-p",
    prompt,
    "--mcp-config",
    MCP_CONFIG,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(budgetUsd),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  const token = opts.token ?? fetchGithubToken();
  if (token) env.GITHUB_TOKEN = token;
  if (opts.anthropicKey) env.ANTHROPIC_API_KEY = opts.anthropicKey;
  if (opts.geminiKey) env.GEMINI_API_KEY = opts.geminiKey;

  const findingLabel = finding.cve_id ?? finding.id;
  out.write(
    `[agentic-dispatcher] ${new Date().toISOString()}\n` +
      `[agentic-dispatcher] repo: ${repoFull}  finding: ${findingLabel} (${finding.kind})\n` +
      `[agentic-dispatcher] bin: claude (-p headless, MCP: ${MCP_CONFIG})\n` +
      `[agentic-dispatcher] guardrails: --max-budget-usd=${budgetUsd} · timeout=${Math.round(timeoutMs / 1000)}s\n` +
      `[agentic-dispatcher] ─────────────────────────────\n`,
  );

  const child = spawn("claude", args, { env, windowsHide: true });

  let killedByTimeout = false;
  const timeoutHandle = setTimeout(() => {
    if (!child.killed && child.pid) {
      killedByTimeout = true;
      try {
        out.write(
          `\n[agentic-dispatcher] ─────────────────────────────\n` +
            `[agentic-dispatcher] wall-clock timeout (${Math.round(timeoutMs / 1000)}s) hit at ${new Date().toISOString()}\n`,
        );
      } catch { /* stream may be half-closed */ }
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "pipe" });
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }
  }, timeoutMs);

  // Use a synthetic issue number of 0 for findings — the PR pipeline
  // uses the finding ID in the branch name instead.
  const dispatch: Dispatch = {
    id,
    repo_url: repoUrl,
    mode: "agentic",
    dry_run: true,
    issue_number: 0,
    started_at: new Date().toISOString(),
    status: "running",
    pid: child.pid,
    log_path: logPath,
  };

  pipeStreamJson(child.stdout, out);
  child.stderr.on("data", () => {}); // swallow stderr (MCP startup noise)
  child.on("close", (code, signal) => {
    clearTimeout(timeoutHandle);
    dispatch.ended_at = new Date().toISOString();
    dispatch.exit_code = code ?? undefined;
    const wasKilled = signal === "SIGKILL" || signal === "SIGTERM" || killedByTimeout;
    dispatch.status = wasKilled ? "killed" : code === 0 ? "succeeded" : "failed";
    out.write(
      `\n[agentic-dispatcher] ─────────────────────────────\n` +
        `[agentic-dispatcher] exited at ${dispatch.ended_at} · status=${dispatch.status} · exit=${code ?? "n/a"}` +
        (killedByTimeout ? " (killed by wall-clock timeout)" : "") +
        `\n`,
    );
    out.end();

    if (!wasKilled && code === 0 && process.env.OPENSRCER_AGENTIC_AUTO_PR !== "0") {
      void (async () => {
        await new Promise((r) => setTimeout(r, 250));
        await appendFile(logPath,
          `\n[agentic-pr] ─────────────────────────────\n` +
          `[agentic-pr] starting auto-PR at ${new Date().toISOString()}\n`,
        ).catch(() => {});
        try {
          const result = await createDraftPrFromLog({
            repoFull,
            issueNumber: 0,
            logPath,
            dispatchId: id,
            orgCtx: opts.orgCtx,
            findingId: findingLabel,
          });
          const line = result.ok
            ? `[agentic-pr] opened draft PR: ${result.url}\n` +
              `[agentic-pr] head: ${result.branch}  →  base: ${result.base.branch} (${result.base.confidence} confidence — ${result.base.reason})\n`
            : `[agentic-pr] skipped: ${result.reason}\n`;
          await appendFile(logPath, line).catch(() => {});
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          await appendFile(logPath, `[agentic-pr] unexpected error: ${msg}\n`).catch(() => {});
        }
      })();
    }
  });
  child.on("error", (err) => {
    dispatch.ended_at = new Date().toISOString();
    dispatch.status = "failed";
    out.write(`\n[agentic-dispatcher] spawn error: ${err.message}\n`);
    out.end();
  });

  return dispatch;
}
