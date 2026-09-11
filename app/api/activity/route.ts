import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { getStatsSummary } from "@/lib/stats";

// /api/activity — real opensrcer activity (scans, dispatches, PRs,
// "biggest contributions"). Not to be confused with /api/stats which
// serves the Overview page's seed/demo numbers.
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const s = await getStatsSummary(owner);
    return NextResponse.json(s);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
