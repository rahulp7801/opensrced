import { NextRequest, NextResponse } from "next/server";
import { listDrafts, readDraft } from "@/lib/dispatcher";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const issueParam = req.nextUrl.searchParams.get("issue");
  if (issueParam) {
    const data = readDraft(id, Number(issueParam));
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  }
  return NextResponse.json({ drafts: listDrafts(id) });
}
