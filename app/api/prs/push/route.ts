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
import { acquireSlot, releaseSlot, activeSlots } from "@/lib/concurrency";
import { gitAuthArgs } from "@/lib/git-auth";
import { requireSession } from "@/lib/require-session";
import { applyDiff, diffTouchedFiles } from "@/lib/apply-diff";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const MAX_CONCURRENT_PUSHES = 2;

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
  const unauth = await requireSession();
  if (unauth) return unauth;

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

  // Concurrency limit. Acquired LAST, after every cheap rejection above —
  // the slot is only released by the finally below, so anything that
  // returns between acquire and try leaks it permanently. This 401 used to
  // sit inside that window: three unauthenticated requests wedged pushes
  // until the server restarted.
  if (!acquireSlot("push", MAX_CONCURRENT_PUSHES)) {
    return Response.json(
      { error: `Too many concurrent push operations (${activeSlots("push")}/${MAX_CONCURRENT_PUSHES}). Wait for one to finish.` },
      { status: 429 },
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };
  let tmpDir: string | null = null;

  try {
    // 1. Clone the fork (shallow, single branch). Auth goes in a one-shot
    //    header, not the URL — a tokenized remote lands in .git/config and
    //    would survive in tmpDir until cleanup (and past it, if cleanup
    //    fails). See lib/git-auth.ts.
    tmpDir = await mkdtemp(join(tmpdir(), "opensrcer-fix-"));
    const cloneUrl = `https://github.com/${body.repo}.git`;

    await run("git", [...gitAuthArgs(token), "clone", "--depth", "50", "--single-branch", "-b", body.branch, cloneUrl, "."], {
      cwd: tmpDir,
      env,
    });

    // 2. Apply the diff via the shared ladder (lib/apply-diff.ts). The
    //    patch file lives OUTSIDE the repo so it can't get staged. The
    //    clone is --depth 50, so 3-way already has history — no deepen
    //    callback needed here.
    const patchDir = await mkdtemp(join(tmpdir(), "opensrcer-patch-"));
    const diffPath = join(patchDir, "fix.patch");
    const applied = await applyDiff(tmpDir, body.diff, diffPath, { env });

    if (!applied.ok) {
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
            filesInDiff: diffTouchedFiles(body.diff ?? ""),
            strategyErrors: applied.errors,
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
    await run("git", [...gitAuthArgs(token), "-C", tmpDir, "push", "origin", body.branch], { env });

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
    releaseSlot("push");
    // Cleanup temp dir
    if (tmpDir) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
