import { NextRequest, NextResponse } from "next/server";
import { listIssues } from "@/lib/issues";
import { recordScan } from "@/lib/stats";
import { sessionUserId } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { parseRunTarget } from "@/lib/run-target";

export const maxDuration = 60;

function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const target = parseRunTarget(url);
    if (target.issue) return null;
    const [owner, repo] = target.repo.split("/");
    return { owner, repo };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

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
    // Always pull beginner-tagged issues alongside the recent batch — they're
    // usually old (maintainers leave them open for newcomers) and would
    // otherwise be missed by the recent-N fetch.
    const beginnerLabels = [
      "good first issue",
      "beginner",
      "starter",
      "first-timers-only",
      "easy",
    ];
    // Scan as the requesting user. Without a token this still works against
    // public repos, just at the unauthenticated rate limit.
    const token = await resolveGitHubToken();
    const issues = await listIssues(parsed.owner, parsed.repo, 50, beginnerLabels, token, req.signal);
    // Fire-and-forget stats bump — failure here must not break the scan.
    await recordScan(`${parsed.owner}/${parsed.repo}`, owner).catch(() => {});
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
