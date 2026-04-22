// POST /api/prs/push
// Applies a diff to an existing PR branch and pushes.
// Flow: clone fork → checkout branch → apply diff → commit → push.

import { NextRequest } from "next/server";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo?: string; // owner/name (the fork, e.g. rahulp7801/auto-round)
    upstream?: string; // upstream owner/name (e.g. intel/auto-round)
    branch?: string; // PR branch name
    diff?: string; // the diff/patch to apply
    commit_message?: string;
  };

  if (!body.repo || !body.branch || !body.diff) {
    return Response.json(
      { error: "Missing repo, branch, or diff" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  if (!token) {
    return Response.json(
      { error: "No GitHub token available. Log in first." },
      { status: 401 },
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };
  let tmpDir: string | null = null;

  try {
    // 1. Clone the fork (shallow, single branch)
    tmpDir = await mkdtemp(join(tmpdir(), "opensrcer-fix-"));
    const cloneUrl = `https://x-access-token:${token}@github.com/${body.repo}.git`;

    await run("git", ["clone", "--depth", "50", "--single-branch", "-b", body.branch, cloneUrl, "."], {
      cwd: tmpDir,
      env,
    });

    // 2. Apply the diff
    const diffPath = join(tmpDir, "__fix.patch");
    await writeFile(diffPath, body.diff);

    // Try applying with increasing fuzziness
    let applied = false;
    const strategies = [
      ["apply", "--check", "__fix.patch"],
      ["apply", "__fix.patch"],
    ];

    // First check if it applies cleanly
    try {
      await run("git", ["-C", tmpDir, "apply", "--check", "__fix.patch"], { env });
      // It applies cleanly, now actually apply
      await run("git", ["-C", tmpDir, "apply", "__fix.patch"], { env });
      applied = true;
    } catch {
      // Try with whitespace ignore
      try {
        await run("git", ["-C", tmpDir, "apply", "--ignore-whitespace", "__fix.patch"], { env });
        applied = true;
      } catch {
        // Try 3-way merge
        try {
          await run("git", ["-C", tmpDir, "apply", "--3way", "__fix.patch"], { env });
          applied = true;
        } catch {
          // Last resort: try as a unified diff with patch command
          try {
            await run("git", ["-C", tmpDir, "apply", "--3way", "--ignore-whitespace", "__fix.patch"], { env });
            applied = true;
          } catch {
            // Give up
          }
        }
      }
    }

    if (!applied) {
      return Response.json(
        { error: "Could not apply the diff. The file may have changed since the diff was generated." },
        { status: 422 },
      );
    }

    // 3. Stage all changes
    await run("git", ["-C", tmpDir, "add", "-A"], { env });

    // Check if there are actually changes
    try {
      await run("git", ["-C", tmpDir, "diff", "--cached", "--quiet"], { env });
      // No changes — diff applied but resulted in no diff (maybe already applied)
      return Response.json(
        { error: "No changes after applying diff. The fix may already be applied." },
        { status: 422 },
      );
    } catch {
      // Good — there are staged changes
    }

    // 4. Commit
    const authorName = process.env.OPENSRCER_COMMIT_NAME ?? "rahulp7801";
    const authorEmail =
      process.env.OPENSRCER_COMMIT_EMAIL ?? "76501505+rahulp7801@users.noreply.github.com";
    const commitMsg = body.commit_message ?? "address review feedback";

    await run(
      "git",
      [
        "-C", tmpDir,
        "-c", `user.name=${authorName}`,
        "-c", `user.email=${authorEmail}`,
        "commit",
        "-m", commitMsg,
      ],
      { env },
    );

    // 5. Push
    await run("git", ["-C", tmpDir, "push", "origin", body.branch], { env });

    // 6. Get the new commit SHA
    const newSha = await run("git", ["-C", tmpDir, "rev-parse", "HEAD"], { env });

    return Response.json({
      ok: true,
      commit: newSha.slice(0, 8),
      message: `Pushed commit ${newSha.slice(0, 8)} to ${body.repo}/${body.branch}`,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    // Cleanup temp dir
    if (tmpDir) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
