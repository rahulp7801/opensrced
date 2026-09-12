import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { getStatsSummary } from "@/lib/stats";

// /api/activity — account-scoped opensrcer activity derived from recorded
// scans, dispatches, provider spend, and opened pull requests.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const s = await getStatsSummary(owner);
    return NextResponse.json(s);
  } catch {
    return NextResponse.json({ error: "Activity is temporarily unavailable." }, { status: 503 });
  }
}
