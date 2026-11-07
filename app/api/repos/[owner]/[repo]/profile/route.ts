// GET /api/repos/<owner>/<repo>/profile — the repository's unwritten rules
// (lib/repo-profile.ts): measured from its recent PRs, stored on the repo's
// row and reused for a day. Read with the requesting user's GitHub token.

import { getDb } from "@/lib/db/client";
import { resolveGitHubToken } from "@/lib/github-token";
import { gh } from "@/lib/gh";
import { sanitizeGitHubName } from "@/lib/sanitize";
import { sessionUserId } from "@/lib/require-session";
import { engagementAdvice, profileFindings, repoProfile, RepoNotFoundError, RepoProfileFetchError } from "@/lib/repo-profile";

export const dynamic = "force-dynamic";
// Three GitHub searches with nested reviews: usually 10–20 s.
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  if (!await sessionUserId()) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { owner, repo } = await params;
  if (sanitizeGitHubName(owner) !== owner || sanitizeGitHubName(repo) !== repo) {
    return Response.json({ error: "Expected /api/repos/<owner>/<repo>/profile." }, { status: 400 });
  }
  const token = await resolveGitHubToken();
  if (!token) return Response.json({ error: "Sign in with GitHub again to read this repository." }, { status: 401 });
  try {
    const profile = await repoProfile(await getDb(), gh(token), `${owner}/${repo}`);
    return Response.json({ profile, findings: profileFindings(profile), advice: engagementAdvice(profile) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof RepoNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    console.error("[repos/profile]", error instanceof RepoProfileFetchError ? error.cause : error);
    return Response.json({ error: "GitHub didn't answer in time. Try again in a minute." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
