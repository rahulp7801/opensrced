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
import { sanitizeRepoId, sanitizeBranchName, sanitizeCommitMessage } from "@/lib/sanitize";

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
  const raw = (await req.json().catch(() => ({}))) as {
    repo?: string;
    upstream?: string;
    branch?: string;
    diff?: string;
    commit_message?: string;
  };

  const body = {
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
    upstream: raw.upstream ? sanitizeRepoId(raw.upstream) : null,
    branch: raw.branch ? sanitizeBranchName(raw.branch) : null,
    diff: raw.diff?.slice(0, 100_000) ?? null, // cap diff size
    commit_message: raw.commit_message ? sanitizeCommitMessage(raw.commit_message) : "address review feedback",
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

    // 2. Apply the diff — try multiple strategies since Claude's diff
    //    format varies (sometimes missing a/b prefixes, sometimes it's
    //    a search-replace block rather than unified diff).
    let applied = false;

    // Strategy A: try as a git-apply unified diff
    const diffPath = join(tmpDir, "__fix.patch");
    const fixedDiff = normalizeDiff(body.diff);
    await writeFile(diffPath, fixedDiff);

    const gitApplyStrategies = [
      ["apply", "__fix.patch"],
      ["apply", "--ignore-whitespace", "__fix.patch"],
      ["apply", "--3way", "__fix.patch"],
      ["apply", "--3way", "--ignore-whitespace", "__fix.patch"],
    ];

    for (const args of gitApplyStrategies) {
      if (applied) break;
      try {
        await run("git", ["-C", tmpDir, ...args], { env });
        applied = true;
      } catch {
        // try next strategy
      }
    }

    // Strategy B: if git apply failed, try GNU patch with fuzz
    if (!applied) {
      try {
        await run("patch", ["-p1", "--fuzz=3", "-i", "__fix.patch"], {
          cwd: tmpDir,
          env,
        });
        applied = true;
      } catch {
        // try without -p1
        try {
          await run("patch", ["-p0", "--fuzz=3", "-i", "__fix.patch"], {
            cwd: tmpDir,
            env,
          });
          applied = true;
        } catch {
          // continue to Strategy C
        }
      }
    }

    // Strategy C: if the diff contains search-replace style content,
    //   try to apply it as direct file edits
    if (!applied) {
      applied = await tryDirectEdit(tmpDir, body.diff);
    }

    if (!applied) {
      return Response.json(
        {
          error:
            "Could not apply the diff. Try regenerating the fix, or apply it manually.",
          diff: body.diff,
        },
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

// ── Diff normalization ────────────────────────────────────────────────
// Claude sometimes outputs diffs without proper a/ b/ prefixes or
// with missing ---/+++ headers. Normalize to standard unified diff.

function normalizeDiff(raw: string): string {
  let diff = raw;

  // If the diff has ---/+++ lines without a/ b/ prefixes, add them
  diff = diff.replace(
    /^--- ([^/\n][^\n]*)/gm,
    (_, path) => `--- a/${path.replace(/^a\//, "")}`,
  );
  diff = diff.replace(
    /^\+\+\+ ([^/\n][^\n]*)/gm,
    (_, path) => `+++ b/${path.replace(/^b\//, "")}`,
  );

  return diff;
}

// ── Direct file edit fallback ─────────────────────────────────────────
// When the diff isn't a proper unified diff, try to parse it as a
// "replace this with that" instruction and apply directly.

async function tryDirectEdit(dir: string, rawDiff: string): Promise<boolean> {
  // Look for patterns like:
  //   --- a/path/to/file
  //   +++ b/path/to/file
  //   @@ ... @@
  //   -old line
  //   +new line
  // Even if git apply fails, we can extract the file path and the
  // old→new line mapping and do a string replace.

  const fileMatch = rawDiff.match(/^\+\+\+ (?:b\/)?(\S+)/m);
  if (!fileMatch) return false;

  const filePath = fileMatch[1];
  const absPath = join(dir, filePath);

  let content: string;
  try {
    const { readFile: rf } = await import("node:fs/promises");
    content = await rf(absPath, "utf8");
  } catch {
    return false;
  }

  // Extract removed and added lines from the diff
  const lines = rawDiff.split("\n");
  const removals: string[] = [];
  const additions: string[] = [];

  for (const line of lines) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      removals.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions.push(line.slice(1));
    }
  }

  if (removals.length === 0 && additions.length === 0) return false;

  // Try to find the old block in the file and replace it
  const oldBlock = removals.join("\n");
  const newBlock = additions.join("\n");

  if (oldBlock && content.includes(oldBlock)) {
    const updated = content.replace(oldBlock, newBlock);
    if (updated !== content) {
      await writeFile(absPath, updated);
      return true;
    }
  }

  // Try line-by-line replacement for single-line changes
  if (removals.length === 1 && additions.length === 1) {
    const oldLine = removals[0].trim();
    const newLine = additions[0];
    if (oldLine && content.includes(oldLine)) {
      // Replace the first occurrence, preserving leading whitespace
      const lines = content.split("\n");
      let replaced = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === oldLine && !replaced) {
          const indent = lines[i].match(/^(\s*)/)?.[1] ?? "";
          lines[i] = indent + newLine.trim();
          replaced = true;
        }
      }
      if (replaced) {
        await writeFile(absPath, lines.join("\n"));
        return true;
      }
    }
  }

  return false;
}
