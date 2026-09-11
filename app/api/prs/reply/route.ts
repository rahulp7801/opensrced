// POST /api/prs/reply
// Posts a reply to a PR review comment or a general PR comment.

import { NextRequest } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";
import { requireSession } from "@/lib/require-session";


import { githubApi } from "@/lib/github-api";

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
    repo: typeof raw.repo === "string" ? sanitizeRepoId(raw.repo) : null,
    pr_number: raw.pr_number ? sanitizePrNumber(raw.pr_number) : null,
    comment_id: raw.comment_id,
    body: typeof raw.body === "string" ? raw.body.trim() : null,
    type: raw.type === "review" ? "review" as const : "issue" as const,
  };

  if (!body.repo || !body.body || body.body.length > 20_000 || !body.pr_number || (body.type === "review" && (!Number.isSafeInteger(body.comment_id) || body.comment_id! < 1))) {
    return Response.json(
      { error: "Missing repo, pr_number, or body" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  if (!token) {
    return Response.json({ error: "No GitHub token" }, { status: 401 });
  }
  try {
    const path = body.type === "review"
      ? `/repos/${body.repo}/pulls/${body.pr_number}/comments/${body.comment_id}/replies`
      : `/repos/${body.repo}/issues/${body.pr_number}/comments`;
    await githubApi(path, token, { body: body.body });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
