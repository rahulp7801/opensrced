// Shallow-clone cache for repos the MCP server serves tools against.
//
// Design:
//   - One cache dir per repo at <root>/<owner>__<name>/.
//   - `ensureRepo(repo)` returns the absolute path, (re)cloning on first use
//     or if the clone is older than TTL_MS. `git fetch --depth=1` would be
//     cheaper than a re-clone for refresh, but safer-on-error (a corrupt
//     clone just gets blown away).
//   - In-process locks prevent two parallel tool calls from racing the clone.
//     We serialise by repo but not across processes — the MCP server is a
//     single long-lived stdio process, so that's enough.
//   - Auth: if GITHUB_TOKEN is set in the env (injected by the dispatcher
//     for crucible / private-org flows), it is passed as a one-shot
//     `-c http.extraheader` so private repos clone successfully. It is
//     deliberately NOT baked into the remote URL — that writes the token
//     into .git/config, where it outlives the run in a 24h-lived cache.
//     Public flows leave GITHUB_TOKEN unset and clone anonymously.
//
// Cache root:
//   - $OPENSRCER_CACHE_DIR if set (useful for tests)
//   - else ~/.contribai/repos/ (matches the existing CONTRIBAI_* convention)

import { execFile } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TTL_MS = 24 * 60 * 60 * 1000; // 24h before re-clone

// Duplicated from lib/git-auth.ts — the MCP server is a separate package
// with its own tsconfig and cannot import from the Next app. Four lines is
// cheaper than a shared build target.
function gitAuthArgs(token?: string): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${basic}`];
}

function cacheRoot(): string {
  if (process.env.OPENSRCER_CACHE_DIR) return process.env.OPENSRCER_CACHE_DIR;
  return path.join(homedir(), ".contribai", "repos");
}

export type RepoRef = { owner: string; name: string; full: string };

export function parseRepo(repo: string): RepoRef {
  // Accept "owner/name", "https://github.com/owner/name", "git@github.com:owner/name.git"
  const trimmed = repo.trim().replace(/\.git$/i, "");
  const m =
    /^(?:https?:\/\/github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+)$/i.exec(
      trimmed,
    );
  if (!m) throw new Error(`Unrecognized repo: ${repo}`);
  return { owner: m[1], name: m[2], full: `${m[1]}/${m[2]}` };
}

function repoDir(r: RepoRef): string {
  return path.join(cacheRoot(), `${r.owner}__${r.name}`);
}

const locks = new Map<string, Promise<string>>();

export async function ensureRepo(repo: string): Promise<{ ref: RepoRef; dir: string }> {
  const ref = parseRepo(repo);
  const dir = repoDir(ref);
  const inflight = locks.get(dir);
  if (inflight) return { ref, dir: await inflight };

  const job = (async () => {
    const gitDir = path.join(dir, ".git");
    let needsClone = !existsSync(gitDir);
    if (!needsClone) {
      try {
        // Age is read from the clone stamp, NOT from .git's mtime — git
        // touches .git on every read operation, so an actively used cache
        // entry never looked stale and never refreshed.
        const stampPath = path.join(dir, ".opensrcer-cloned-at");
        const s = await stat(existsSync(stampPath) ? stampPath : gitDir);
        if (Date.now() - s.mtimeMs > TTL_MS) needsClone = true;
      } catch {
        needsClone = true;
      }
    }
    if (needsClone) {
      // Another process may be mid-dispatch against this clone — the MCP
      // server, lib/pre-index.ts and agentic-pr's worktree all share this
      // directory, and the in-process `locks` map above only serialises
      // callers inside THIS process. Blowing the directory away underneath
      // a live worktree corrupts that run, so take a cross-process lock
      // and skip the refresh rather than fight over it.
      const lock = await acquireDirLock(dir);
      if (!lock) {
        // Someone else holds it. A slightly stale clone is strictly better
        // than a deleted one.
        if (existsSync(gitDir)) return dir;
        // Nothing usable on disk — wait for the holder to finish cloning.
        await waitForLock(dir);
        if (existsSync(gitDir)) return dir;
        throw new Error(`clone of ${ref.full} is locked by another process and no cached copy exists`);
      }
      try {
        return await doClone(ref, dir);
      } finally {
        await releaseDirLock(dir);
      }
    }
    return dir;
  })();
  locks.set(dir, job);
  try {
    const d = await job;
    return { ref, dir: d };
  } finally {
    locks.delete(dir);
  }
}

// ── Cross-process clone lock ──────────────────────────────────────────
// An O_EXCL lockfile: atomic to create, and holding a pid + timestamp so
// a crashed holder can be reaped instead of wedging the cache forever.

const LOCK_STALE_MS = 10 * 60 * 1000;

function lockPath(dir: string): string {
  return `${dir}.lock`;
}

async function acquireDirLock(dir: string): Promise<boolean> {
  const p = lockPath(dir);
  await mkdir(path.dirname(p), { recursive: true });
  try {
    // wx = fail if it already exists. Atomic on every platform we target.
    await writeFile(p, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
    return true;
  } catch {
    // Reap a lock whose holder died mid-clone.
    try {
      const s = await stat(p);
      if (Date.now() - s.mtimeMs > LOCK_STALE_MS) {
        await rm(p, { force: true });
        await writeFile(p, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
        return true;
      }
    } catch {
      /* lost the race to another reaper */
    }
    return false;
  }
}

async function releaseDirLock(dir: string): Promise<void> {
  await rm(lockPath(dir), { force: true }).catch(() => {});
}

/** Poll until the lock clears or we give up (~30s). */
async function waitForLock(dir: string): Promise<void> {
  const p = lockPath(dir);
  for (let i = 0; i < 60; i++) {
    if (!existsSync(p)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function doClone(ref: RepoRef, dir: string): Promise<string> {
  // Blow away anything stale so a half-broken clone can't poison the cache
  // indefinitely. Re-clone is slow (~1–30s on a small repo) but deterministic.
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(cacheRoot(), { recursive: true });
  // Auth via a one-shot header, never a tokenized remote URL — the latter
  // lands in .git/config and persists in the cache long after the run that
  // needed it. See lib/git-auth.ts in the parent app.
  const url = `https://github.com/${ref.full}.git`;
  await execFileAsync(
    "git",
    [...gitAuthArgs(process.env.GITHUB_TOKEN), "clone", "--depth=1", "--single-branch", url, dir],
    { maxBuffer: 50 * 1024 * 1024 },
  );
  // Freshness stamp — see the TTL check in ensureRepo for why .git's mtime
  // can't be used.
  await writeFile(path.join(dir, ".opensrcer-cloned-at"), new Date().toISOString());
  return dir;
}
