// GET /api/harness/profile?repo=owner/name — the repo profile for the harness
// (lib/repo-profile.ts), authenticated by a personal token (lib/harness.ts).
// Read with the server's public-read token; without one, only a stored
// profile can be served.

import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { gh } from "@/lib/gh";
import { HarnessAuthError, harnessUser } from "@/lib/harness";
import { profileFindings, repoProfile, RepoNotFoundError, storedProfile } from "@/lib/repo-profile";
import { splitRepo } from "@/lib/ai-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const db = await getDb();
  try {
    await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  let owner: string, name: string;
  try { [owner, name] = splitRepo(new URL(req.url).searchParams.get("repo") ?? ""); } catch {
    return Response.json({ error: "Expected ?repo=owner/name." }, { status: 400 });
  }
  const token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN;
  try {
    const profile = token ? await repoProfile(db, gh(token), `${owner}/${name}`) : await storedProfile(db, owner, name);
    if (!profile) return Response.json({ error: "No profile has been built for this repository yet. Open it on opensrcer once." }, { status: 404 });
    return Response.json({ profile, findings: profileFindings(profile), page: `${new URL(req.url).origin}/repos/${profile.repo}` });
  } catch (error) {
    if (error instanceof RepoNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    console.error("[harness/profile]", error);
    return Response.json({ error: "GitHub didn't answer in time. Try again in a minute." }, { status: 503 });
  }
}
