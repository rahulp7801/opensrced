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
//     for crucible / private-org flows), the clone URL is rewritten to
//     https://x-access-token:<token>@github.com/<owner>/<name>.git so
//     private repos clone successfully. Public flows leave GITHUB_TOKEN
//     unset and fall through to the anonymous URL.
//
// Cache root:
//   - $OPENSRCER_CACHE_DIR if set (useful for tests)
//   - else ~/.contribai/repos/ (matches the existing CONTRIBAI_* convention)

import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TTL_MS = 24 * 60 * 60 * 1000; // 24h before re-clone

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
        const s = await stat(gitDir);
        if (Date.now() - s.mtimeMs > TTL_MS) needsClone = true;
      } catch {
        needsClone = true;
      }
    }
    if (needsClone) {
      // Blow away anything stale so a half-broken clone can't poison the
      // cache indefinitely. Re-clone is slow (~1–30s on a small repo) but
      // deterministic.
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
      await mkdir(cacheRoot(), { recursive: true });
      const token = process.env.GITHUB_TOKEN;
      const url = token
        ? `https://x-access-token:${token}@github.com/${ref.full}.git`
        : `https://github.com/${ref.full}.git`;
      await execFileAsync("git", ["clone", "--depth=1", "--single-branch", url, dir], {
        maxBuffer: 50 * 1024 * 1024,
      });
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
