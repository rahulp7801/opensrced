import { NextResponse } from "next/server";
import { cancelDispatch } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { cancelCloudRun } from "@/lib/cloud-runs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // Killing a run is destructive, and this accepted any id from any
  // authenticated caller. cancelDispatch now scopes to the owner and
  // reports a miss identically either way.
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (cloudExecution()) {
    const ok = await cancelCloudRun(viewerId, id);
    return NextResponse.json({ ok }, { status: ok ? 202 : 404 });
  }
  const result = cancelDispatch(id, viewerId);
  return NextResponse.json(result, { status: result.ok ? 202 : 404 });
}
