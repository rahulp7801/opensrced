import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { enrichPR, enrichRepo } from "@/lib/enrich";
import { getRepos } from "@/lib/seed";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);

  const upstreamRepos = await proxy<Array<Record<string, unknown>>>(`/api/repos?limit=${limit}`);
  if (upstreamRepos && Array.isArray(upstreamRepos)) {
    // Fetch a deep slice of PRs to compute merge_rate per repo.
    const upstreamPRs = await proxy<Array<Record<string, unknown>>>(`/api/prs?limit=500`);
    const prs = (upstreamPRs ?? []).map(enrichPR);
    const enriched = upstreamRepos.map((r) => enrichRepo(r, prs));
    return NextResponse.json(enriched);
  }

  return NextResponse.json(getRepos(limit));
}
