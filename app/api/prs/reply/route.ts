// POST /api/prs/reply
// Posts a reply to a PR review comment or issue comment.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo?: string;
    comment_id?: number;
    body?: string;
    type?: "review" | "issue";
  };

  if (!body.repo || !body.comment_id || !body.body) {
    return Response.json({ error: "Missing repo, comment_id, or body" }, { status: 400 });
  }

  const token = await resolveGitHubToken();
  if (!token) {
    return Response.json({ error: "No GitHub token" }, { status: 401 });
  }
  const env: NodeJS.ProcessEnv = { ...process.env, GH_TOKEN: token };

  try {
    // Reply to a review comment (inline code comment)
    if (body.type === "review") {
      await execFileAsync(
        "gh",
        [
          "api",
          `repos/${body.repo}/pulls/comments/${body.comment_id}/replies`,
          "-f", `body=${body.body}`,
        ],
        { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      );
    } else {
      // Reply to an issue comment (general PR comment)
      // We post a new issue comment since issue comments don't have threading
      const prMatch = body.repo.match(/^([^/]+\/[^/]+)$/);
      if (!prMatch) {
        return Response.json({ error: "Invalid repo format" }, { status: 400 });
      }
      // Extract PR number from the original comment to post on the right issue
      await execFileAsync(
        "gh",
        [
          "api",
          `repos/${body.repo}/issues/comments`,
          "-f", `body=${body.body}`,
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
