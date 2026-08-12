// POST /api/prs/reply
// Posts a reply to a PR review comment or a general PR comment.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizeForPrompt, sanitizePrNumber } from "@/lib/sanitize";
import { requireSession } from "@/lib/require-session";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const raw = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_number?: number;
    comment_id?: number;
    body?: string;
    type?: "review" | "issue";
  };

  const body = {
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
    pr_number: raw.pr_number ? sanitizePrNumber(raw.pr_number) : null,
    comment_id: raw.comment_id,
    body: raw.body ? sanitizeForPrompt(raw.body) : null,
    type: raw.type === "review" ? "review" as const : "issue" as const,
  };

  if (!body.repo || !body.body || !body.pr_number) {
    return Response.json(
      { error: "Missing repo, pr_number, or body" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  if (!token) {
    return Response.json({ error: "No GitHub token" }, { status: 401 });
  }
  const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };

  try {
    if (body.type === "review" && body.comment_id) {
      // Reply to an inline review comment
      await execFileAsync(
        "gh",
        [
          "api",
          `repos/${body.repo}/pulls/comments/${body.comment_id}/replies`,
          "-f",
          `body=${body.body}`,
        ],
        { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      );
    } else {
      // Post a general comment on the PR (issue comment)
      await execFileAsync(
        "gh",
        [
          "api",
          `repos/${body.repo}/issues/${body.pr_number}/comments`,
          "-f",
          `body=${body.body}`,
        ],
        { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
