import { NextRequest, NextResponse } from "next/server";
import { listIssues } from "@/lib/issues";
import { recordScan } from "@/lib/stats";

function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[:/]+([^/]+)\/([^/?#\s]+?)(?:\.git)?$/.exec(url.trim());
  if (m) return { owner: m[1], repo: m[2] };
  const m2 = /^([^/\s]+)\/([^/\s]+)$/.exec(url.trim());
  if (m2) return { owner: m2[1], repo: m2[2] };
  return null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("repo");
  if (!url) {
    return NextResponse.json({ error: "missing ?repo=" }, { status: 400 });
  }
  const parsed = parseRepo(url);
  if (!parsed) {
    return NextResponse.json(
      { error: `unrecognized repo URL: ${url}` },
      { status: 400 },
    );
  }
  try {
    const issues = await listIssues(parsed.owner, parsed.repo, 50);
    // Fire-and-forget stats bump — failure here must not break the scan.
    void recordScan(`${parsed.owner}/${parsed.repo}`).catch(() => {});
    return NextResponse.json({
      repo: `${parsed.owner}/${parsed.repo}`,
      total: issues.length,
      solvable: issues.filter((i) => i.solvable).length,
      issues,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
