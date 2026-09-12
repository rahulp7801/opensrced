import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { getStatsSummary } from "@/lib/stats";

// /api/activity — account-scoped opensrcer activity derived from recorded
// scans, dispatches, provider spend, and opened pull requests.
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
