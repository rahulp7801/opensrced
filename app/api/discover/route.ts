import { NextRequest, NextResponse } from "next/server";
import { discover } from "@/lib/discover";
import { recordDiscoverRun } from "@/lib/stats";
import { sessionUserId } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";

export const maxDuration = 60;

// GET /api/discover?min_stars=500&language=python&repo_limit=12&issues_per_repo=20&max_repo_age_days=180
// Returns { repos, issues } — no LLM, no Anthropic spend.
export async function GET(req: NextRequest) {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const minStars = Math.max(10, Number(sp.get("min_stars") ?? 500));
  const maxStarsRaw = Number(sp.get("max_stars") ?? 0);
  const maxStars = Number.isFinite(maxStarsRaw) && maxStarsRaw > 0 ? maxStarsRaw : undefined;
  const language = sp.get("language") || undefined;
  const repoLimit = sp.get("repo_limit") ? Number(sp.get("repo_limit")) : undefined;
  const issuesPerRepo = sp.get("issues_per_repo") ? Number(sp.get("issues_per_repo")) : undefined;
  const maxRepoAgeDays = sp.get("max_repo_age_days")
    ? Number(sp.get("max_repo_age_days"))
    : undefined;

  try {
    const numeric = [minStars, maxStars, repoLimit, issuesPerRepo, maxRepoAgeDays];
    if (numeric.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      return NextResponse.json({ error: "Search limits must be finite non-negative numbers." }, { status: 400 });
    }
    const result = await discover({
      minStars,
      maxStars,
      language,
      repoLimit,
      issuesPerRepo,
      maxRepoAgeDays,
    }, await resolveGitHubToken(), AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]));
    await recordDiscoverRun(owner).catch(() => {});
    return NextResponse.json({
      query: { minStars, maxStars, language, repoLimit, issuesPerRepo, maxRepoAgeDays },
      repo_count: result.repos.length,
      issue_count: result.issues.length,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
