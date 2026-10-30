// GET /api/recs/similar?repo=owner/name&issue=123&limit=5
// Worked examples for an issue (PLAN.md §6.2): similar solved issues and the
// merged PRs that fixed them. Behind OPENSRCER_RECS. An issue outside the
// catalog index answers { indexed: false } rather than an error, so the
// drawer can say so.

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { sanitizeGitHubName } from "@/lib/sanitize";
import { IssueNotIndexedError, similarToIssue } from "@/lib/recs/similar";
import { sessionUserId } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!flagEnabled("recs")) return Response.json({ error: "Not found" }, { status: 404 });
  if (!await sessionUserId()) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const [owner, name, extra] = (sp.get("repo") ?? "").split("/");
  const number = Number(sp.get("issue"));
  const limit = Number(sp.get("limit") ?? 5);
  if (extra !== undefined || !owner || !name || sanitizeGitHubName(owner) !== owner || sanitizeGitHubName(name) !== name
      || !Number.isSafeInteger(number) || number < 1 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    return Response.json({ error: "Expected ?repo=owner/name&issue=N (limit 1–20)." }, { status: 400 });
  }
  try {
    const examples = await similarToIssue(await getDb(), owner, name, number, { limit });
    return Response.json({ indexed: true, examples }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof IssueNotIndexedError) return Response.json({ indexed: false, examples: [] });
    console.error("[recs/similar]", error);
    return Response.json({ error: "Worked examples are unavailable right now." }, { status: 503 });
  }
}
