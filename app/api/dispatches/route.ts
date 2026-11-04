// GET /api/dispatches — the caller's own dispatches, newest first.
//
// This used to return every dispatch on the box to any authenticated user.
// A dispatch log holds the target repo's source, the generated diff and the
// issue body — for crucible runs, all of it from a private repo.

import { NextResponse } from "next/server";
import { listDispatches } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { listCloudRunSummaries } from "@/lib/cloud-runs";
import { visibleRuns } from "@/lib/hidden-runs";

export const maxDuration = 60;

export async function GET() {
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (cloudExecution()) {
    try {
      // A lesson's hidden fix keeps its row but loses its PR title and has_diff.
      const dispatches = await visibleRuns(viewerId, await listCloudRunSummaries(viewerId, 20));
      return NextResponse.json({ dispatches });
    } catch (error) {
      console.error("[runs] could not list runs", error);
      return NextResponse.json({ error: "Run history is temporarily unavailable. Please retry." }, { status: 503 });
    }
  }
  return NextResponse.json({ dispatches: await visibleRuns(viewerId, listDispatches(viewerId, 20)) });
}
