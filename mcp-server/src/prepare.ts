#!/usr/bin/env node
// `node dist/prepare.js owner/name` — clone (or reuse) the cached checkout the
// MCP tools serve, and print {"dir","sha"} as one JSON line.
//
// The dispatcher calls this before starting the agent, so the exec box and the
// contribution-profile detection see exactly the commit the tools will read.
// Same access rules as the tools: OPENSRCER_ALLOWED_REPO, GITHUB_TOKEN.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureRepo } from "./repo-cache.js";

delete process.env.ANTHROPIC_API_KEY;
process.env.GIT_LFS_SKIP_SMUDGE = "1";

const repo = process.argv[2];
try {
  if (!repo) throw new Error("usage: prepare.js owner/name");
  const { dir } = await ensureRepo(repo);
  const { stdout } = await promisify(execFile)("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 30_000, windowsHide: true });
  process.stdout.write(`${JSON.stringify({ dir, sha: stdout.trim() })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
