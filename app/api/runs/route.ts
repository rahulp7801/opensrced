import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { enrichRun } from "@/lib/enrich";
import { getRuns } from "@/lib/seed";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  const upstream = await proxy<Array<Record<string, unknown>>>(`/api/runs?limit=${limit}`);
  if (upstream && Array.isArray(upstream)) {
    return NextResponse.json(upstream.map((r, i) => enrichRun(r, i)));
  }
  return NextResponse.json(getRuns(limit));
}
