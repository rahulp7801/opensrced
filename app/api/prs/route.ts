import { NextResponse } from "next/server";
import { loadPRsFromLogs } from "@/lib/pr-loader";

export async function GET() {
  const prs = await loadPRsFromLogs();
  return NextResponse.json(prs);
}
