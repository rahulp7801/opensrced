import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { loadPRsFromLogs } from "@/lib/pr-loader";

export async function GET() {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const prs = await loadPRsFromLogs();
  return NextResponse.json(prs);
}
