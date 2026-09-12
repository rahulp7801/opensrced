// GET /api/dispatches — the caller's own dispatches, newest first.
//
// This used to return every dispatch on the box to any authenticated user.
// A dispatch log holds the target repo's source, the generated diff and the
// issue body — for crucible runs, all of it from a private repo.

import { NextResponse } from "next/server";
import { listDispatches } from "@/lib/dispatcher";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { listCloudRuns } from "@/lib/cloud-runs";

export const maxDuration = 60;

export async function GET() {
  const viewerId = await sessionUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (cloudExecution()) {
    try {
      const runs = await listCloudRuns(viewerId, 20);
      const dispatches = runs.map((run) => {
        const summary = { ...run } as Partial<typeof run>;
        delete summary.log;
        return summary;
      });
      return NextResponse.json({ dispatches });
    } catch {
      return NextResponse.json({ error: "Run history is temporarily unavailable. Please retry." }, { status: 503 });
    }
  }
  return NextResponse.json({ dispatches: listDispatches(viewerId, 20) });
}
