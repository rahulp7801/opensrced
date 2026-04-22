// Shared graph build logic. Clones a repo and runs graphify to produce
// a knowledge graph. Used by both the /api/graph/generate route (with
// streaming progress) and the verify route (silent, blocking).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { graphCacheDir, graphJsonPath } from "./graph";
import { resolveGitHubToken } from "./github-token";

export async function ensureGraph(
  owner: string,
  repo: string,
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

      let token: string | null = null;
      try {
        token = await resolveGitHubToken();
      } catch {
        // No token — try anonymous clone
      }

      const cloneUrl = token
        ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
        : `https://github.com/${owner}/${repo}.git`;

      await execAsync("git", ["clone", "--depth", "1", cloneUrl, "."], {
        cwd: cacheDir,
        timeout: 120_000,
      });
    }

    // Run graphify
    const useModule = process.platform === "win32";
    const cmd = useModule ? "python" : "graphify";
    const args = useModule ? ["-m", "graphify", "update", "."] : ["update", "."];

    await execAsync(cmd, args, { cwd: cacheDir, timeout: 300_000 });

    return { built: true, cached: false };
  } catch (err) {
    return {
      built: false,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function execAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: "pipe",
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
