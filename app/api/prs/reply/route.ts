import { readJsonBody } from "@/lib/request-body";
// POST /api/prs/reply
// Posts a reply to a PR review comment or a general PR comment.

import { NextRequest } from "next/server";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";
import { sessionUserId } from "@/lib/require-session";


import { githubApi } from "@/lib/github-api";
import { resolveRepositoryToken } from "@/lib/crucible/tokens";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const raw = ((await readJsonBody(req)) ?? {}) as {
    repo?: string;
    pr_number?: number;
    comment_id?: number;
    body?: string;
    type?: "review" | "issue";
  };

  if (!raw) return Response.json({ error: "Invalid request" }, { status: 400 });

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

  let token: string | null;
  try { token = (await resolveRepositoryToken(userId, body.repo, req.signal)).token ?? null; }
  catch { return Response.json({ error: "Repository not accessible" }, { status: 403 }); }
  if (!token) {
    return Response.json({ error: "No GitHub token" }, { status: 401 });
  }
  try {
    const path = body.type === "review"
      ? `/repos/${body.repo}/pulls/${body.pr_number}/comments/${body.comment_id}/replies`
      : `/repos/${body.repo}/issues/${body.pr_number}/comments`;
    await githubApi(path, token, { body: body.body }, req.signal);

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
