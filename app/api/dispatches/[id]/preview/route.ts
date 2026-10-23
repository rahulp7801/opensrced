// GET /api/dispatches/<id>/preview — the frozen publish-gate preview: the
// exact patch, PR text, evidence, warnings and blockers. Owner only.

import { NextResponse } from "next/server";
import { join } from "node:path";
import { sessionUserId } from "@/lib/require-session";
import { getDispatch } from "@/lib/dispatcher";
import { readPreview } from "@/lib/pr-preview";
import { CONFIRMATION } from "@/lib/publish";
import { cloudExecution } from "@/lib/cloud-run-state";
import { getCloudRun } from "@/lib/cloud-runs";
import { getCloudPreview } from "@/lib/cloud-publish";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    // Both lookups answer "not yours" like "missing".
    const d = cloudExecution() ? await getCloudRun(viewerId, id) : getDispatch(id, viewerId);
    if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
    const stored = cloudExecution() ? await getCloudPreview(viewerId, id) : await readPreview(join(process.cwd(), ".dispatches", id));
    if (!stored) return NextResponse.json({ error: "no preview for this run" }, { status: 404 });
    return NextResponse.json({ ...stored.preview, diff: stored.diff, confirmation: CONFIRMATION, publishable: !d.dry_run && (d.pr_status === "awaiting_review" || d.pr_status === "failed"),
      // A follow-up run publishes as one commit on this PR, not a new PR.
      ...(d.followup_pr ? { followup_pr: d.followup_pr } : {}) });
  } catch {
    return NextResponse.json({ error: "This preview is temporarily unavailable. Please retry." }, { status: 503 });
  }
}
