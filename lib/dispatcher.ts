// Local dispatcher. Spawns `contribai.exe target <url> [--dry-run]` as a
// subprocess, streams stdout/stderr to .dispatches/<id>.log, and exposes
// progress via an in-memory map surfaced through /api/dispatches.
//
// Intended for single-node local use. Dispatches do not survive Next.js
// process restarts, but the log files do.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DISPATCH_DIR = join(process.cwd(), ".dispatches");

export type DispatchStatus = "running" | "succeeded" | "failed" | "killed";

export type DispatchMode = "target" | "solve" | "hunt" | "agentic";

/** The PR half of a dispatch's lifecycle — tracked independently of the
 *  child-process exit status. A dispatch can exit 0 (Claude wrote a good
 *  response) and still have pr_status=failed (auto-PR hook crashed). */
export type PrStatus =
  | "opened"         // A github.com/<o>/<r>/pull/<n> URL is present in the log
  | "failed"         // `[agentic-pr] skipped: <reason>` appears
  | "pending"        // auto-PR started but hasn't resolved yet
  | "tests_passed"   // crucible sandbox tests passed; PR open path proceeding
  | "tests_failed"   // crucible sandbox tests failed; PR was NOT opened
  | "none";          // no auto-PR expected (dry-run, target/hunt mode, or too early)

export type Dispatch = {
  id: string;
  repo_url: string;
  mode: DispatchMode;
  dry_run: boolean;
  /** When mode === "solve" and `--issue N` was passed, the issue number. */
  issue_number?: number;
  /** GitHub issue title, fetched lazily via gh and cached on disk. */
  issue_title?: string;
  started_at: string;
  ended_at?: string;
  status: DispatchStatus;
  pid?: number;
  log_path: string;
  exit_code?: number;
  /** PR half of the lifecycle. Computed from the log in listDispatches()
   *  / getDispatch(). Separate from `status` because the Claude child and
   *  the auto-PR post-hook can succeed/fail independently. */
  pr_status?: PrStatus;
  /** Human-readable failure reason from `[agentic-pr] skipped:` when
   *  pr_status === "failed". */
  pr_failure_reason?: string;
};

// In-memory registry. Surviving logs are reconstructed from disk on read.
const registry = new Map<string, Dispatch>();
const children = new Map<string, ChildProcess>();

// ── Issue-title cache ──────────────────────────────────────────────────
// Keyed by "owner/repo#N". Fetched via `gh issue view` the first time a
// dispatch referencing that issue is listed; written back to disk so HMR
// + fresh boots don't re-fetch. TTL'd at 30 days — titles are almost never
// edited, and a stale title is harmless UX anyway.
const TITLE_CACHE_FILE = join(DISPATCH_DIR, "issue-titles.json");
const TITLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TitleCache = Record<string, { title: string; fetchedAt: number }>;

let titleCacheMem: TitleCache | null = null;
function loadTitleCache(): TitleCache {
  if (titleCacheMem) return titleCacheMem;
  try {
    titleCacheMem = JSON.parse(readFileSync(TITLE_CACHE_FILE, "utf8")) as TitleCache;
  } catch {
    titleCacheMem = {};
  }
  return titleCacheMem;
}
function saveTitleCache(c: TitleCache) {
  try {
    ensureDir();
    // Sync write — the file is tiny (hundreds of short entries). Async
    // would need plumbing through the otherwise-sync lookup path.
    writeFileSync(TITLE_CACHE_FILE, JSON.stringify(c));
  } catch {
    /* best effort */
  }
}

function titleCacheKey(repoFull: string, issueNumber: number): string {
  return `${repoFull}#${issueNumber}`;
}

// Best-effort async title fetch. Never throws — title is optional UX.
// Kicks off a gh subprocess; on completion updates the on-disk cache so
// the next poll cycle picks it up.
const inflight = new Set<string>();
function fetchIssueTitleAsync(repoFull: string, issueNumber: number): void {
  const key = titleCacheKey(repoFull, issueNumber);
  const cache = loadTitleCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.fetchedAt < TITLE_TTL_MS) return;
  if (inflight.has(key)) return;
  inflight.add(key);

  const gh = process.env.GH_CLI && existsSync(process.env.GH_CLI) ? process.env.GH_CLI : "gh";
  const child = spawn(
    gh,
    ["issue", "view", String(issueNumber), "--repo", repoFull, "--json", "title"],
    { windowsHide: true },
  );
  let out = "";
  child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
  child.on("close", () => {
    inflight.delete(key);
    try {
      const parsed = JSON.parse(out) as { title?: string };
      if (parsed.title) {
        const c = loadTitleCache();
        c[key] = { title: parsed.title, fetchedAt: Date.now() };
        saveTitleCache(c);
      }
    } catch {
      /* failed gh call: leave cache alone; retry on next poll */
    }
  });
  child.on("error", () => {
    inflight.delete(key);
  });
}

/** Pull title from cache (never blocks); trigger a background fetch if
 *  missing/stale. UI sees `issue_title` appear on a later poll. */
function lookupTitle(repoFull: string, issueNumber: number): string | undefined {
  const key = titleCacheKey(repoFull, issueNumber);
  const cache = loadTitleCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.fetchedAt < TITLE_TTL_MS) return hit.title;
  fetchIssueTitleAsync(repoFull, issueNumber);
  return hit?.title; // return stale if expired — better than nothing
}

// ── PR-status resolver ──────────────────────────────────────────────────
// Reads the dispatch log and decides what happened on the auto-PR side.
// Called on every listDispatches() / getDispatch() so that any dispatch
// whose auto-PR resolved between polls updates its status naturally.
//
// Log signals:
//   "github.com/<o>/<r>/pull/<n>"      -> opened
//   "[agentic-pr] skipped: <reason>"   -> failed, reason captured
//   "[agentic-pr] starting auto-PR"    -> pending (started, not done)
//   (none of the above, status=succeeded) -> undefined (dry-run / target
//                                            / hunt; no PR expected)
function enrichWithPrStatus(d: Dispatch): Dispatch {
  if (d.status === "running") return d;
  try {
    const text = readFileSync(d.log_path, "utf8");
    // Order matters: a crucible run that passes tests AND opens a PR
    // shows both markers in the log. Surface the opened PR as the
    // terminal state, annotated with `tests_passed` only when the
    // PR isn't yet opened.
    const prOpened = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(text);
    const testsPassed = /\[crucible-tests\] status=passed/.test(text);
    const testsFailed = /\[crucible-tests\] status=(?:failed|error)/.test(text);

    if (prOpened) return { ...d, pr_status: "opened" };
    if (testsFailed) {
      const reasonM = /\[crucible-tests\] reason=([^\n]+)/.exec(text);
      const reason = reasonM ? reasonM[1].trim().slice(0, 500) : "sandbox tests failed";
      return { ...d, pr_status: "tests_failed", pr_failure_reason: reason };
    }
    const skipM = /\[agentic-pr\] skipped:\s*([^\n]+(?:\n(?![\[\n])[^\n]+)*)/.exec(text);
    if (skipM) {
      const reason = skipM[1].replace(/\s+/g, " ").trim().slice(0, 500);
      return { ...d, pr_status: "failed", pr_failure_reason: reason };
    }
    if (testsPassed) return { ...d, pr_status: "tests_passed" };
    if (/\[agentic-pr\] starting auto-PR/.test(text)) {
      return { ...d, pr_status: "pending" };
    }
  } catch {
    /* log unreadable — leave pr_status undefined */
  }
  return d;
}

/** Parse "owner/name" from a repo URL or bare slug. */
function parseRepoFull(s: string): string | null {
  const t = s.trim().replace(/\.git$/i, "");
  const m = /github\.com[:/]+([^/]+)\/([^/?#\s]+)/.exec(t);
  if (m) return `${m[1]}/${m[2]}`;
  const b = /^([^/\s]+)\/([^/\s]+)$/.exec(t);
  if (b) return `${b[1]}/${b[2]}`;
  return null;
}

function ensureDir() {
  if (!existsSync(DISPATCH_DIR)) mkdirSync(DISPATCH_DIR, { recursive: true });
}

export function canDispatchLocally(): boolean {
  return Boolean(process.env.CONTRIBAI_BIN);
}

function fetchGithubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = process.env.GH_CLI;
  if (!gh || !existsSync(gh)) return undefined;
  try {
    const out = execFileSync(gh, ["auth", "token"], { encoding: "utf8", timeout: 4000 }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export type StartDispatchOpts = {
  // Pre-resolved token. Crucible (private-org) flows resolve the
  // installation token via lib/crucible/tokens.ts::resolveGithubToken
  // before calling. Public flows omit this and we fall back to
  // fetchGithubToken() (PAT → gh CLI).
  token?: string;
  // User-provided Anthropic API key (from encrypted cookie).
  anthropicKey?: string;
};

export function startDispatch(
  repoUrl: string,
  dryRun: boolean,
  mode: DispatchMode = "target",
  extraArgs: string[] = [],
  opts: StartDispatchOpts = {},
): Dispatch {
  const bin = process.env.CONTRIBAI_BIN;
  if (!bin) throw new Error("CONTRIBAI_BIN is not set");
  if (!existsSync(bin)) throw new Error(`contribai binary not found at ${bin}`);

  ensureDir();
  const id = `d_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${randomUUID().slice(0, 6)}`;
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  // `hunt` takes no positional arg; target/solve take a repo URL.
  const args: string[] = mode === "hunt" ? ["hunt", "-v"] : [mode, repoUrl, "-v"];
  if (dryRun) args.push("--dry-run");
  args.push(...extraArgs);
  const config = process.env.CONTRIBAI_CONFIG;
  if (config) args.push("--config", config);

  const env: NodeJS.ProcessEnv = { ...process.env };
  const token = opts.token ?? fetchGithubToken();
  if (token) env.GITHUB_TOKEN = token;
  if (opts.anthropicKey) env.ANTHROPIC_API_KEY = opts.anthropicKey;
  // GEMINI_API_KEY is already inherited from process.env

  // On dry-run solves, tell contribai to dump each generated contribution as JSON
  // to .dispatches/<id>/draft-*.json so the UI can preview it before going live.
  const draftDir = join(DISPATCH_DIR, id);
  if (dryRun && mode === "solve") {
    env.CONTRIBAI_DRAFT_DIR = draftDir;
  }

  // Skip the LLM self-review gate by default — when running with a small
  // local model it rejects its own output too aggressively and discards
  // otherwise-good drafts. The dashboard's DraftPreview UI is the real
  // human review gate. Override with CONTRIBAI_DISABLE_SELF_REVIEW=0.
  if (env.CONTRIBAI_DISABLE_SELF_REVIEW === undefined) {
    env.CONTRIBAI_DISABLE_SELF_REVIEW = "1";
  }

  // Always create draft PRs (not ready-for-review). The user wants every
  // automatically-opened PR to be a draft so they can review/refine before
  // marking ready. Override with CONTRIBAI_DRAFT_PR=0 to ship live PRs.
  if (env.CONTRIBAI_DRAFT_PR === undefined) {
    env.CONTRIBAI_DRAFT_PR = "1";
  }

  const out = createWriteStream(logPath);
  out.write(
    `[dispatcher] ${new Date().toISOString()}\n` +
    `[dispatcher] bin: ${bin}\n` +
    `[dispatcher] args: ${args.join(" ")}\n` +
    `[dispatcher] env: GITHUB_TOKEN=${token ? "(present, " + token.length + " chars)" : "(missing)"} · GEMINI_API_KEY=${env.GEMINI_API_KEY ? "(present)" : "(missing)"} · ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY ? "(present)" : "(missing)"}\n` +
    `[dispatcher] ─────────────────────────────\n`,
  );

  const child = spawn(bin, args, { env, windowsHide: true });
  // Extract --issue N from extraArgs so the UI can build a direct link
  // back to the GitHub issue.
  let issueNumber: number | undefined;
  for (let i = 0; i < extraArgs.length - 1; i++) {
    if (extraArgs[i] === "--issue") {
      const n = Number(extraArgs[i + 1]);
      if (Number.isFinite(n)) issueNumber = n;
      break;
    }
  }
  const dispatch: Dispatch = {
    id,
    repo_url: repoUrl,
    mode,
    dry_run: dryRun,
    issue_number: issueNumber,
    started_at: new Date().toISOString(),
    status: "running",
    pid: child.pid,
    log_path: logPath,
  };
  registry.set(id, dispatch);
  children.set(id, child);

  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on("close", (code, signal) => {
    dispatch.ended_at = new Date().toISOString();
    dispatch.exit_code = code ?? undefined;
    // On Windows, taskkill produces exit code 1 and no signal; we track the
    // intent via `cancelRequested`.
    const wasKilled =
      signal === "SIGKILL" || signal === "SIGTERM" || cancelRequested.has(id);
    dispatch.status = wasKilled ? "killed" : code === 0 ? "succeeded" : "failed";
    cancelRequested.delete(id);
    children.delete(id);
    out.write(
      `\n[dispatcher] ─────────────────────────────\n` +
      `[dispatcher] exited at ${dispatch.ended_at} · status=${dispatch.status} · exit=${code ?? "n/a"}${wasKilled ? " (cancelled by user)" : ""}\n`,
    );
    out.end();
  });
  child.on("error", (err) => {
    dispatch.ended_at = new Date().toISOString();
    dispatch.status = "failed";
    out.write(`\n[dispatcher] spawn error: ${err.message}\n`);
    out.end();
  });

  return dispatch;
}

const cancelRequested = new Set<string>();

/** Cancel a running dispatch. Kills the child process tree on Windows. */
export function cancelDispatch(id: string): { ok: boolean; message: string } {
  const d = registry.get(id);
  const child = children.get(id);

  if (child && !child.killed) {
    cancelRequested.add(id);
    // Windows: ChildProcess.kill() sends CTRL_C_EVENT which is ignored by
    // many CLIs. Use taskkill /T to kill the whole process tree.
    if (process.platform === "win32" && child.pid) {
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
          stdio: "pipe",
        });
      } catch {
        child.kill("SIGKILL");
      }
    } else {
      child.kill("SIGKILL");
    }
    return { ok: true, message: `Cancel requested for ${id}` };
  }

  // Fallback: look up the PID from the registry and taskkill it (useful if
  // the child-process handle was lost to an HMR reload).
  if (d?.pid && process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(d.pid)], {
        stdio: "pipe",
      });
      cancelRequested.add(id);
      return { ok: true, message: `Killed pid ${d.pid} (via taskkill)` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ok: false, message: `No running process found for dispatch ${id}` };
}

export function listDrafts(id: string): Array<{ issue_number: number; title: string; path: string }> {
  const draftDir = join(DISPATCH_DIR, id);
  if (!existsSync(draftDir)) return [];
  const out: Array<{ issue_number: number; title: string; path: string }> = [];
  for (const f of readdirSync(draftDir)) {
    const m = /^issue-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const path = join(draftDir, f);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { title?: string };
      out.push({ issue_number: Number(m[1]), title: parsed.title ?? "", path });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => a.issue_number - b.issue_number);
  return out;
}

export function readDraft(id: string, issueNumber: number) {
  const path = join(DISPATCH_DIR, id, `issue-${issueNumber}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function listDispatches(): Dispatch[] {
  // Merge in-memory with filesystem-only records (from previous runs).
  const fromFs: Dispatch[] = [];
  if (existsSync(DISPATCH_DIR)) {
    for (const f of readdirSync(DISPATCH_DIR)) {
      if (!f.endsWith(".log")) continue;
      const id = f.slice(0, -4);
      if (registry.has(id)) continue;
      // Reconstruct a minimal record from header
      try {
        const full = readFileSync(join(DISPATCH_DIR, f), "utf8");
        const head = full.slice(0, 800);
        // Three log formats to handle:
        //   [dispatcher] — deterministic contribai path (lib/dispatcher.ts)
        //   [agentic-dispatcher] — claude -p MCP path (lib/agentic-dispatcher.ts)
        //   legacy/unknown — fall back to blank fields
        const isAgentic = /^\[agentic-dispatcher\]/m.test(head);

        // Started-at: accept either prefix. Matches ISO 8601 with or
        // without fractional seconds / timezone offset.
        const startedMatch = /^\[(?:agentic-)?dispatcher\]\s+(\d{4}-\d\d-\d\dT[^\s]+)/m.exec(head);

        let mode: DispatchMode;
        let repo = "";
        let dry = false;
        let issueNum: number | undefined;

        if (isAgentic) {
          // [agentic-dispatcher] repo: owner/name  issue: #N
          mode = "agentic";
          dry = true; // agentic path is always preview-side; auto-PR runs after
          const repoM = /\[agentic-dispatcher\]\s+repo:\s*(\S+)\s+issue:\s*#?(\d+)/m.exec(head);
          if (repoM) {
            repo = repoM[1].startsWith("http") ? repoM[1] : `https://github.com/${repoM[1]}`;
            issueNum = Number(repoM[2]);
          }
        } else {
          // Deterministic path — parse the args line.
          const argsMatch = /^\[dispatcher\]\s+args:\s+(\S+)\s?(.*)$/m.exec(head);
          mode = (argsMatch?.[1] as DispatchMode) ?? "target";
          const rest = argsMatch?.[2] ?? "";
          repo = mode === "hunt" ? "" : (rest.split(" ")[0] ?? "");
          dry = /--dry-run/.test(rest);
          const issueMatch = /--issue\s+(\d+)/.exec(rest);
          issueNum = issueMatch ? Number(issueMatch[1]) : undefined;
        }

        // Exit-status line lives somewhere in the tail and is written by
        // both dispatcher variants with the same shape.
        const endedMatch = /exited at (\S+)\s+·\s+status=(\w+)\s+·\s+exit=(\S+)/.exec(full);

        // Pull title from cache if we have a repo+issue pair; missing
        // titles trigger a background gh fetch for the next poll cycle.
        const repoFull = repo ? parseRepoFull(repo) : null;
        const title =
          repoFull && issueNum !== undefined ? lookupTitle(repoFull, issueNum) : undefined;

        fromFs.push({
          id,
          repo_url: repo,
          mode,
          dry_run: dry,
          issue_number: issueNum,
          issue_title: title,
          started_at: startedMatch?.[1] ?? new Date(0).toISOString(),
          ended_at: endedMatch?.[1],
          status: (endedMatch?.[2] as DispatchStatus) ?? "running",
          exit_code: endedMatch ? Number(endedMatch[3]) : undefined,
          log_path: join(DISPATCH_DIR, f),
        });
      } catch {
        /* skip unreadable */
      }
    }
  }
  // Enrich in-memory records with titles from the cache — when a dispatch
  // is freshly started its registry entry has no title, and we want the
  // UI to backfill it the moment the title fetcher returns.
  const memEnriched = [...registry.values()].map((d) => {
    if (d.issue_title || d.issue_number === undefined) return d;
    const repoFull = parseRepoFull(d.repo_url);
    if (!repoFull) return d;
    const t = lookupTitle(repoFull, d.issue_number);
    return t ? { ...d, issue_title: t } : d;
  });

  const list = [...memEnriched, ...fromFs].map(enrichWithPrStatus);
  list.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return list;
}

export function getDispatch(id: string): Dispatch | undefined {
  const fromRegistry = registry.get(id);
  if (fromRegistry) return enrichWithPrStatus(fromRegistry);
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  if (!existsSync(logPath)) return undefined;
  // Reconstruct from disk (listDispatches already runs enrichWithPrStatus)
  return listDispatches().find((d) => d.id === id);
}

export function readLog(id: string, maxBytes = 200_000): string {
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  if (!existsSync(logPath)) return "";
  const buf = readFileSync(logPath);
  if (buf.length <= maxBytes) return buf.toString("utf8");
  // tail
  return "…(truncated — showing last " + maxBytes + " bytes)…\n" + buf.slice(-maxBytes).toString("utf8");
}
