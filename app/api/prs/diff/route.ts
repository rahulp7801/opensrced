// GET /api/prs/diff?repo=owner/name&pr=123
// Fetches the PR diff via the GitHub API. Loaded lazily by the review page.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";


import { githubText } from "@/lib/github-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const rawRepo = req.nextUrl.searchParams.get("repo");
  const rawPr = req.nextUrl.searchParams.get("pr");
  if (!rawRepo || !rawPr) {
    return Response.json({ error: "Missing repo or pr" }, { status: 400 });
  }
  const repo = sanitizeRepoId(rawRepo);
  const pr = sanitizePrNumber(rawPr);
  if (!repo || !pr) {
    return Response.json({ error: "Invalid repo or pr" }, { status: 400 });
  }

  const token = await resolveGitHubToken();
  try {
    const diff = await githubText(`/repos/${repo}/pulls/${pr}`, token, "application/vnd.github.diff", 4_000_000);
    return Response.json({ diff });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
