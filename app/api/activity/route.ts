import { NextResponse } from "next/server";
import { getStatsSummary } from "@/lib/stats";

// /api/activity — real opensrcer activity (scans, dispatches, PRs,
// "biggest contributions"). Not to be confused with /api/stats which
// serves the Overview page's seed/demo numbers.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await getStatsSummary();
    return NextResponse.json(s);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
