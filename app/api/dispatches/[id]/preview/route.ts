// GET /api/dispatches/<id>/preview — the frozen publish-gate preview: the
// exact patch, PR title/body, evidence, warnings and blockers. Owner only.

import { NextResponse } from "next/server";
import { join } from "node:path";
import { sessionUserId } from "@/lib/require-session";
import { getDispatch } from "@/lib/dispatcher";
import { readPreview } from "@/lib/pr-preview";
import { CONFIRMATION } from "@/lib/publish";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  // getDispatch validates the id and answers "not yours" like "missing".
  const d = getDispatch(id, viewerId);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stored = await readPreview(join(process.cwd(), ".dispatches", id));
  if (!stored) return NextResponse.json({ error: "no preview for this run" }, { status: 404 });
  return NextResponse.json({ ...stored.preview, diff: stored.diff, confirmation: CONFIRMATION, publishable: !d.dry_run && d.pr_status === "awaiting_review" });
}
