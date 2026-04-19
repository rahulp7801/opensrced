import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { enrichPR } from "@/lib/enrich";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", String(limit));

  const upstream = await proxy<Array<Record<string, unknown>>>(`/api/prs?${qs.toString()}`);
  if (upstream && Array.isArray(upstream)) {
    return NextResponse.json(upstream.map(enrichPR));
  }
  return NextResponse.json([]);
}
