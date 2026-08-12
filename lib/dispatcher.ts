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
import { listAll as listSidecars, persist, read as readSidecar } from "./dispatch-store";
import { childEnv, ghEnv } from "./child-env";

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
  /** Auth0 `sub` of the user who started this dispatch.
   *
   *  Dispatches are per-user resources: the log holds the target repo's
   *  source, the generated diff, the issue body, and for crucible runs all
   *  of that from a PRIVATE repo. Without an owner every authenticated user
   *  could read, and cancel, every other user's runs — /api/dispatches
   *  listed all of them and /api/dispatches/<id> returned the full log.
   *
   *  Optional because dispatches written before this field existed don't
   *  have it. Those are treated as owned by nobody and hidden from every
   *  user rather than shown to all of them — see ownsDispatch(). */
  auth0_user_id?: string;
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
  /** Did the repo's own test suite actually run against the patch?
   *
   *  Tracked separately from pr_status because a PR can be opened while
   *  wholly unverified — public flows skip the runner unless
   *  OPENSRCER_RUN_TESTS=all. "Verified" in the UI must mean `passed`
   *  here and nothing else; "skipped" is a repo with no recognized test
   *  suite, "not_run" is us choosing not to execute it. */
  tests?: "passed" | "failed" | "skipped" | "not_run";
};

// In-memory registry. Surviving logs are reconstructed from disk on read.
const registry = new Map<string, Dispatch>();
const children = new Map<string, ChildProcess>();

// Dispatch ids are minted here and nowhere else, so they have a known shape.
// Every function below joins an id onto DISPATCH_DIR to build a filesystem
// path; validating the shape once means none of them can be handed `../..`
// from a route parameter.
const DISPATCH_ID_RE = /^d_[A-Za-z0-9_-]{1,64}$/;

export function isValidDispatchId(id: string): boolean {
  return DISPATCH_ID_RE.test(id);
}

/** Can `viewerId` see this dispatch? Records with no owner (written before
 *  the field existed) belong to nobody and are visible to nobody — the log
 *  files are still on disk, they just stop being served. Showing them to
 *  everyone instead is the exact leak this field exists to close. */
export function ownsDispatch(d: Dispatch, viewerId: string | null): boolean {
  if (!viewerId) return false;
  return d.auth0_user_id === viewerId;
}

/** Register a dispatch + its child so cancelDispatch() can find them.
 *
 *  The agentic path lives in lib/agentic-dispatcher.ts and used to skip
 *  this entirely, which meant cancelDispatch() found no registry entry, no
 *  child handle and no PID — every cancel on the primary dispatch path
 *  returned "No running process found". Both spawners call this now. */
export function registerDispatch(d: Dispatch, child: ChildProcess): void {
  registry.set(d.id, d);
  children.set(d.id, child);
  persist(d);
  child.on("close", () => children.delete(d.id));
}

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
    // Title lookup for the dashboard: a public read, with no inherited
    // environment for gh to find the host credential in.
    { windowsHide: true, env: ghEnv(null) },
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
// Exported for tests — marker precedence here decides what the dashboard
// reports for every pre-sidecar dispatch, and it is pure regex.
export function enrichWithPrStatus(input: Dispatch): Dispatch {
  let d = input;
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
    const gitleaksFailed = /\[gitleaks\] status=leaks_found/.test(text);

    // Independent of pr_status: a PR can be opened AND unverified.
    const testsM = /\[crucible-tests\] status=(passed|failed|error|skipped|not_run)/.exec(text);
    const tests: Dispatch["tests"] | undefined = testsM
      ? testsM[1] === "error"
        ? "failed"
        : (testsM[1] as Dispatch["tests"])
      : undefined;
    d = tests ? { ...d, tests } : d;

    if (prOpened) return { ...d, pr_status: "opened" };
    if (gitleaksFailed) {
      const countM = /\[gitleaks\] findings=(\d+)/.exec(text);
      const reason = `gitleaks blocked PR: ${countM?.[1] ?? "?"} secret(s) found in generated code`;
      return { ...d, pr_status: "failed", pr_failure_reason: reason };
    }
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

export type StartDispatchOpts = {
  // Pre-resolved token. Crucible (private-org) flows resolve the
  // installation token via lib/crucible/tokens.ts::resolveGithubToken
  // before calling. There is deliberately no env/CLI fallback: a
  // background dispatch must never silently run as the deployer.
  token?: string;
  // User-provided Anthropic API key (from encrypted cookie).
  anthropicKey?: string;
  // Auth0 `sub` of the requesting user — recorded on the dispatch so only
  // they can read its log or cancel it.
  auth0UserId?: string;
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

  // Allowlisted environment: the child gets PATH, HOME and friends plus the
  // credentials this one user supplied — never AUTH0_SECRET, the GitHub App
  // private key, or the webhook secret. See lib/child-env.ts.
  const token = opts.token;
  const env: NodeJS.ProcessEnv = childEnv({
    GITHUB_TOKEN: token,
    ANTHROPIC_API_KEY: opts.anthropicKey,
    CONTRIBAI_CONFIG: process.env.CONTRIBAI_CONFIG,
  });

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
    auth0_user_id: opts.auth0UserId,
    repo_url: repoUrl,
    mode,
    dry_run: dryRun,
    issue_number: issueNumber,
    started_at: new Date().toISOString(),
    status: "running",
    pid: child.pid,
    log_path: logPath,
  };
  registerDispatch(dispatch, child);

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
    persist(dispatch);
  });
  child.on("error", (err) => {
    dispatch.ended_at = new Date().toISOString();
    dispatch.status = "failed";
    out.write(`\n[dispatcher] spawn error: ${err.message}\n`);
    out.end();
    persist(dispatch);
  });

  return dispatch;
}

const cancelRequested = new Set<string>();

/** Cancel a running dispatch. Kills the child process tree on Windows.
 *
 *  Scoped to the viewer: killing someone else's run is a destructive action,
 *  and this used to accept any id from any authenticated caller. */
export function cancelDispatch(
  id: string,
  viewerId: string | null,
): { ok: boolean; message: string } {
  if (!isValidDispatchId(id)) {
    return { ok: false, message: `No running process found for dispatch ${id}` };
  }
  const d = registry.get(id) ?? readSidecar(id) ?? undefined;
  if (!d || !ownsDispatch(d, viewerId)) {
    // Same message as a genuine miss — don't confirm the id exists.
    return { ok: false, message: `No running process found for dispatch ${id}` };
  }
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
  if (!isValidDispatchId(id)) return [];
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
  if (!isValidDispatchId(id) || !Number.isInteger(issueNumber) || issueNumber < 0) return null;
  const path = join(DISPATCH_DIR, id, `issue-${issueNumber}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function listDispatches(viewerId: string | null): Dispatch[] {
  // Sidecars are the fast path: one small JSON per dispatch, written at
  // each state transition. Anything with a sidecar never needs its log
  // opened. See lib/dispatch-store.ts.
  const fromSidecars = listSidecars();
  const covered = new Set<string>([...registry.keys(), ...fromSidecars.map((d) => d.id)]);

  // Legacy fallback: dispatches from before sidecars existed. Their state
  // is reconstructed by parsing the log, which is why this is slow and why
  // it only runs for ids the sidecars don't cover.
  const fromFs: Dispatch[] = [];
  if (existsSync(DISPATCH_DIR)) {
    for (const f of readdirSync(DISPATCH_DIR)) {
      if (!f.endsWith(".log")) continue;
      const id = f.slice(0, -4);
      if (covered.has(id)) continue;
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
  // In-memory records win over their own sidecar — a live dispatch has a
  // pid and an up-to-the-moment status the file can lag behind by one
  // transition.
  const inMemory = new Set(registry.keys());
  const merged: Dispatch[] = [
    ...registry.values(),
    ...fromSidecars.filter((d) => !inMemory.has(d.id)),
    ...fromFs,
  ];

  // Ownership filter runs BEFORE the enrichment below — enrichWithPrStatus
  // and lookupTitle both do I/O (log reads, background `gh` calls) that
  // there's no reason to spend on records the caller can't see anyway.
  const visible = merged.filter((d) => ownsDispatch(d, viewerId));

  // Backfill issue titles from the cache, and only fall back to reading
  // the log for records whose PR outcome isn't already recorded.
  const list = visible.map((d) => {
    let out = d;
    if (!out.issue_title && out.issue_number !== undefined) {
      const repoFull = parseRepoFull(out.repo_url);
      const t = repoFull ? lookupTitle(repoFull, out.issue_number) : undefined;
      if (t) out = { ...out, issue_title: t };
    }
    return out.pr_status ? out : enrichWithPrStatus(out);
  });
  list.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return list;
}

/** Fetch a dispatch, or undefined when it doesn't exist OR isn't the
 *  viewer's. Both cases return the same "not found" to the caller — telling
 *  an unauthorized viewer that an id exists is itself a small leak. */
export function getDispatch(id: string, viewerId: string | null): Dispatch | undefined {
  if (!isValidDispatchId(id)) return undefined;

  const found = ((): Dispatch | undefined => {
    const fromRegistry = registry.get(id);
    if (fromRegistry) {
      return fromRegistry.pr_status ? fromRegistry : enrichWithPrStatus(fromRegistry);
    }
    const sidecar = readSidecar(id);
    if (sidecar) return sidecar.pr_status ? sidecar : enrichWithPrStatus(sidecar);
    const logPath = join(DISPATCH_DIR, `${id}.log`);
    if (!existsSync(logPath)) return undefined;
    // Legacy record with no sidecar — reconstruct from the log.
    return listDispatches(viewerId).find((d) => d.id === id);
  })();

  if (!found || !ownsDispatch(found, viewerId)) return undefined;
  return found;
}

/** Read the log from a byte offset — the incremental path used by polling.
 *
 *  The dashboard polls a running dispatch every 1.5s. Re-sending the whole
 *  log each time meant up to 200KB per poll for content the client already
 *  had; now it asks for what arrived since `since` and appends.
 *
 *  `size` is the new offset to pass next time. A `size` smaller than
 *  `since` means the log was truncated or replaced, so the caller gets the
 *  whole thing back with reset=true instead of a nonsense slice. */
export function readLogSince(
  id: string,
  since: number,
  maxBytes = 200_000,
): { chunk: string; size: number; reset: boolean } {
  if (!isValidDispatchId(id)) return { chunk: "", size: 0, reset: false };
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  if (!existsSync(logPath)) return { chunk: "", size: 0, reset: false };
  const buf = readFileSync(logPath);
  const size = buf.length;

  if (since > 0 && since <= size) {
    const slice = buf.subarray(since);
    if (slice.length <= maxBytes) {
      return { chunk: slice.toString("utf8"), size, reset: false };
    }
    // Fell far behind (client was backgrounded); send the tail and tell
    // the client to replace rather than append.
    return {
      chunk:
        `…(skipped ${slice.length - maxBytes} bytes)…\n` +
        slice.subarray(slice.length - maxBytes).toString("utf8"),
      size,
      reset: true,
    };
  }

  return { chunk: readLog(id, maxBytes), size, reset: true };
}

export function readLog(id: string, maxBytes = 200_000): string {
  if (!isValidDispatchId(id)) return "";
  const logPath = join(DISPATCH_DIR, `${id}.log`);
  if (!existsSync(logPath)) return "";
  const buf = readFileSync(logPath);
  if (buf.length <= maxBytes) return buf.toString("utf8");
  // tail
  return "…(truncated — showing last " + maxBytes + " bytes)…\n" + buf.slice(-maxBytes).toString("utf8");
}
