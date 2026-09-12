import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { loadPRsFromLogs } from "@/lib/pr-loader";

export async function GET() {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const prs = await loadPRsFromLogs(owner);
    return NextResponse.json(prs);
  } catch {
    return NextResponse.json({ error: "Pull requests are temporarily unavailable. Please retry." }, { status: 503 });
  }
}
