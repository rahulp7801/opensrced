// Shared graph build logic. Clones a repo and runs graphify to produce
// a knowledge graph. Used by both the /api/graph/generate route (with
// streaming progress) and the verify route (silent, blocking).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { graphCacheDir, graphJsonPath } from "./graph";
import { gitAuthArgs } from "./git-auth";
import { childEnv } from "./child-env";
export { graphCacheDir };

export async function ensureGraph(
  owner: string,
  repo: string,
  /** The requesting user's GitHub token, resolved by the calling route.
   *  Omitted means an anonymous clone, which is correct for a public repo
   *  and a clean failure for a private one. */
  token?: string | null,
): Promise<{ built: boolean; cached: boolean; error?: string }> {
  // Already exists — skip
  const jsonPath = graphJsonPath(owner, repo);
  if (existsSync(jsonPath)) {
    return { built: false, cached: true };
  }

  const cacheDir = graphCacheDir(owner, repo);

  try {
    // Clone if needed
    if (!existsSync(`${cacheDir}/.git`)) {
      mkdirSync(cacheDir, { recursive: true });

      // The token comes from the caller — this used to read the deployer's
      // GITHUB_TOKEN and then shell out to `gh auth token` for their
      // keychain, so a graph build kicked off by any user cloned with the
      // operator's credential and could reach private repos the requester
      // has no access to.
      const cloneUrl = `https://github.com/${owner}/${repo}.git`;

      await execAsync("git", [...gitAuthArgs(token), "clone", "--depth", "1", cloneUrl, "."], {
        cwd: cacheDir,
        timeout: 120_000,
      });
    }

    // Run graphify. Use a Python wrapper that raises the recursion limit
    // for large repos (graphify's Leiden clustering can exceed Python's
    // default 1000-deep limit on repos with 500+ files).
    const useModule = process.platform === "win32";
    const cmd = useModule ? "python" : "graphify";
    const args = useModule
      ? ["-c", "import sys; sys.setrecursionlimit(10000); sys.argv=['graphify','update','.']; from graphify.__main__ import main; main()"]
      : ["update", "."];

    await execAsync(cmd, args, { cwd: cacheDir, timeout: 300_000 });

    // Verify graphify output was produced
    if (!existsSync(graphJsonPath(owner, repo))) {
      // Graphify failed (large repo) — fall back to code-review-graph
      try {
        await buildCrg(cacheDir);
        return { built: true, cached: false };
      } catch {
        return {
          built: false,
          cached: false,
          error: "Both graphify and code-review-graph failed on this repo.",
        };
      }
    }

    // Also build CRG for blast radius (it handles large repos better)
    // Blocking — CRG is fast and needed for verification
    try { await buildCrg(cacheDir); } catch { /* CRG build failed — graphify still works */ }

    return { built: true, cached: false };
  } catch (err) {
    return {
      built: false,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Path to the code-review-graph Python package, or null when it isn't
 *  configured.
 *
 *  This used to default to `C:/Users/rahul/crg-pkg` in four separate files.
 *  On any other machine that path doesn't exist, and the failure surfaced as
 *  an opaque Python ImportError rather than "the optional CRG feature isn't
 *  set up". Callers now check for null and degrade cleanly. */
export function crgPythonPath(): string | null {
  return process.env.CRG_PYTHONPATH || null;
}

/** True when CRG-backed features can run at all. */
export function crgAvailable(): boolean {
  return crgPythonPath() !== null;
}

export async function buildCrg(cwd: string): Promise<void> {
  // code-review-graph build — uses SQLite, handles large repos
  const pythonPath = crgPythonPath();
  if (!pythonPath) {
    throw new Error(
      "CRG_PYTHONPATH is not set — graph features need the code-review-graph package. See README → Environment Variables.",
    );
  }
  // pythonPath goes in PYTHONPATH, not spliced into a Python string
  // literal. The old form broke outright on a path containing a quote and
  // was one config change away from being an injection point.
  await execAsync(
    "python",
    ["-c", "import sys; sys.argv=['code-review-graph','build']; from code_review_graph.cli import main; main()"],
    { cwd, timeout: 300_000, env: childEnv({ PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" }) },
  );
}

export function crgDbPath(owner: string, repo: string): string {
  return join(graphCacheDir(owner, repo), ".code-review-graph", "graph.db");
}

export function hasCrg(owner: string, repo: string): boolean {
  return existsSync(crgDbPath(owner, repo));
}

function execAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: "pipe",
      // Allowlisted by default — git and graphify need PATH and HOME, not
      // the app's secrets.
      env: opts.env ?? childEnv(),
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (!proc.killed && proc.pid) {
        if (process.platform === "win32") {
          try {
            require("node:child_process").execFileSync(
              "taskkill",
              ["/F", "/T", "/PID", String(proc.pid)],
              { stdio: "pipe" },
            );
          } catch {
            proc.kill("SIGKILL");
          }
        } else {
          proc.kill("SIGKILL");
        }
      }
      reject(new Error(`${cmd} timed out`));
    }, opts.timeout ?? 120_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed (exit ${code}): ${stderr.slice(-300)}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
