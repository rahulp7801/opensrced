// GET /api/dispatches/<id>/drafts — generated contribution previews for a
// dry-run solve. Same ownership rule as the dispatch itself: the drafts are
// the model's proposed changes to the target repo, and this route had no
// auth check of any kind.

import { NextRequest, NextResponse } from "next/server";
import { getDispatch, listDrafts, readDraft } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!getDispatch(id, viewerId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const issueParam = req.nextUrl.searchParams.get("issue");
  if (issueParam) {
    const data = readDraft(id, Number(issueParam));
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  }
  return NextResponse.json({ drafts: listDrafts(id) });
}
