import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";

const exec = promisify(execFile);

export async function hasBin(cmd: string): Promise<boolean> {
  try {
    await exec(cmd, ["--version"], {
      timeout: 3000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: childEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

async function probeDependencies() {
  const [claude, gh, git, patch, gitleaks, mcp_server_built] = await Promise.all([
    hasBin("claude"), hasBin(process.env.GH_CLI ?? "gh"), hasBin("git"),
    hasBin("patch"), hasBin("gitleaks"),
    access(join(process.cwd(), "mcp-server", "dist", "server.js")).then(() => true, () => false),
  ]);
  return { claude, gh, git, patch, gitleaks, mcp_server_built };
}

// Share concurrent probes and cache their result so polling cannot spawn an
// unbounded number of CLI processes. All probes run off the event loop.
export function dependencyProbe(probe = probeDependencies, ttlMs = 60_000) {
  let pending: ReturnType<typeof probe> | undefined;
  let expiresAt = 0;
  return () => {
    if (!pending || Date.now() >= expiresAt) {
      expiresAt = Infinity;
      pending = probe().then((deps) => {
        expiresAt = Date.now() + ttlMs;
        return deps;
      }, (error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

export const getDependencies = dependencyProbe();
