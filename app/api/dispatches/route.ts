// GET /api/dispatches — the caller's own dispatches, newest first.
//
// This used to return every dispatch on the box to any authenticated user.
// A dispatch log holds the target repo's source, the generated diff and the
// issue body — for crucible runs, all of it from a private repo.

import { NextResponse } from "next/server";
import { listDispatches } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";

export async function GET() {
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ dispatches: listDispatches(viewerId) });
}
