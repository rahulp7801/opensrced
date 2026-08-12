import { NextResponse } from "next/server";
import { cancelDispatch } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";

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
  const result = cancelDispatch(id, viewerId);
  return NextResponse.json(result, { status: result.ok ? 202 : 404 });
}
