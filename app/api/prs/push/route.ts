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
    // Write patch file OUTSIDE the repo to avoid it getting staged
    const patchDir = await mkdtemp(join(tmpdir(), "opensrcer-patch-"));
    const diffPath = join(patchDir, "fix.patch");
    const fixedDiff = normalizeDiff(body.diff);
    await writeFile(diffPath, fixedDiff);

    const gitApplyStrategies = [
      ["apply", diffPath],
      ["apply", "--ignore-whitespace", diffPath],
      ["apply", "--3way", diffPath],
      ["apply", "--3way", "--ignore-whitespace", diffPath],
    ];

    const errors: string[] = [];
    for (const args of gitApplyStrategies) {
      if (applied) break;
      try {
        await run("git", ["-C", tmpDir, ...args], { env });
        applied = true;
      } catch (e) {
        errors.push(`git ${args.join(" ").replace(diffPath, "fix.patch")}: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
      }
    }

    // Strategy B: if git apply failed, try GNU patch with fuzz
    if (!applied) {
      try {
        await run("patch", ["-p1", "--fuzz=3", "--no-backup-if-mismatch", "-i", diffPath], {
          cwd: tmpDir,
          env,
        });
        applied = true;
      } catch {
        // try without -p1
        try {
          await run("patch", ["-p0", "--fuzz=3", "--no-backup-if-mismatch", "-i", diffPath], {
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
          debug: {
            diffLength: body.diff?.length,
            diffPreview: body.diff?.slice(0, 500),
            hasHeaders: /^\+\+\+/m.test(body.diff ?? ""),
            hasPlusMinus: /^[-+][^-+]/m.test(body.diff ?? ""),
            filesInDiff: [...(body.diff ?? "").matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map(m => m[1]),
            strategyErrors: errors,
          },
        },
        { status: 422 },
      );
    }

    // Clean up patch dir
    rm(patchDir, { recursive: true, force: true }).catch(() => {});

    // Remove any junk files that may have been created by patch/apply
    const junkPatterns = ["__fix.patch", "*.orig", "*.rej"];
    for (const pattern of junkPatterns) {
      try {
        const { globSync } = await import("node:fs");
        // Simple cleanup — delete known junk extensions
        const { readdirSync, unlinkSync } = await import("node:fs");
        const files = readdirSync(tmpDir, { recursive: true, encoding: "utf8" }) as string[];
        for (const f of files) {
          if (f.endsWith(".orig") || f.endsWith(".rej") || f === "__fix.patch") {
            try { unlinkSync(join(tmpDir, f)); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      break; // only need to run once
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
  const { readFile: rf } = await import("node:fs/promises");
  const { existsSync: exists } = await import("node:fs");

  // Find the target file — try multiple patterns
  let filePath: string | null = null;
  const filePatterns = [
    /^\+\+\+ (?:b\/)?(\S+)/m,
    /^--- (?:a\/)?(\S+)/m,
    /^diff --git a\/(\S+)/m,
    // Claude sometimes just mentions the file path in text before the diff
    /(?:in|file|modify|change)\s+[`"']?([^\s`"']+\.\w{1,5})[`"']?/im,
  ];
  for (const pat of filePatterns) {
    const m = rawDiff.match(pat);
    if (m && m[1] !== "/dev/null") {
      const candidate = m[1].replace(/^[ab]\//, "");
      if (exists(join(dir, candidate))) {
        filePath = candidate;
        break;
      }
    }
  }

  if (!filePath) return false;

  const absPath = join(dir, filePath);
  let content: string;
  try {
    content = await rf(absPath, "utf8");
  } catch {
    return false;
  }

  // Extract removed and added lines from the diff (skip headers)
  const diffLines = rawDiff.split("\n");
  const removals: string[] = [];
  const additions: string[] = [];
  for (const line of diffLines) {
    if (line.startsWith("-") && !line.startsWith("---") && !line.startsWith("--")) {
      removals.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++") && !line.startsWith("++")) {
      additions.push(line.slice(1));
    }
  }

  if (removals.length === 0 && additions.length === 0) return false;

  // Strategy 1: Exact block match
  const oldBlock = removals.join("\n");
  const newBlock = additions.join("\n");
  if (oldBlock && content.includes(oldBlock)) {
    const updated = content.replace(oldBlock, newBlock);
    if (updated !== content) {
      await writeFile(absPath, updated);
      return true;
    }
  }

  // Strategy 2: Trimmed block match (ignore leading/trailing whitespace per line)
  const contentLines = content.split("\n");
  const trimmedRemovals = removals.map((l) => l.trim());
  if (trimmedRemovals.length > 0 && trimmedRemovals[0]) {
    // Find the starting line in the file
    for (let i = 0; i <= contentLines.length - removals.length; i++) {
      let match = true;
      for (let j = 0; j < trimmedRemovals.length; j++) {
        if (contentLines[i + j].trim() !== trimmedRemovals[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Replace the matched lines, preserving the indent of the first line
        const baseIndent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
        const newLines = additions.map((l) => {
          const trimmed = l.trimStart();
          // Try to preserve original indentation structure
          const origIndent = l.match(/^(\s*)/)?.[1] ?? "";
          return origIndent || trimmed === "" ? l : baseIndent + trimmed;
        });
        contentLines.splice(i, removals.length, ...newLines);
        await writeFile(absPath, contentLines.join("\n"));
        return true;
      }
    }
  }

  // Strategy 3: Single-line fuzzy replacement
  if (removals.length === 1 && additions.length === 1) {
    const oldTrimmed = removals[0].trim();
    if (oldTrimmed.length > 5) {
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === oldTrimmed) {
          const indent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
          contentLines[i] = indent + additions[0].trim();
          await writeFile(absPath, contentLines.join("\n"));
          return true;
        }
      }
    }
  }

  // Strategy 4: Multi-line fuzzy — match first and last removal lines to anchor
  if (removals.length >= 2) {
    const firstTrimmed = removals[0].trim();
    const lastTrimmed = removals[removals.length - 1].trim();
    if (firstTrimmed.length > 5 && lastTrimmed.length > 5) {
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === firstTrimmed) {
          // Found start — look for end
          for (let j = i + 1; j < Math.min(i + removals.length + 5, contentLines.length); j++) {
            if (contentLines[j].trim() === lastTrimmed) {
              // Found anchors — replace the range
              const indent = contentLines[i].match(/^(\s*)/)?.[1] ?? "";
              const newLines = additions.map((l) => {
                const trimmed = l.trimStart();
                return trimmed === "" ? "" : indent + trimmed;
              });
              contentLines.splice(i, j - i + 1, ...newLines);
              await writeFile(absPath, contentLines.join("\n"));
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}
