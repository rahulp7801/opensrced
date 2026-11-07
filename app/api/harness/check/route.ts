// POST /api/harness/check — a pull request draft checked against the
// project's profile (lib/pr-check.ts). Body: {"repo": "owner/name", "draft":
// {title, body, files, additions, deletions, linkedIssue, signedOff?}}.
// The draft's facts only; no code is sent.

import { canUse } from "@/lib/access-server";
import { splitRepo } from "@/lib/ai-policy";
import { getDb } from "@/lib/db/client";
import { gh } from "@/lib/gh";
import { HarnessAuthError, harnessUser, recordEvent } from "@/lib/harness";
import { checkDraft, InvalidDraftError, parseDraft } from "@/lib/pr-check";
import { repoProfile, RepoNotFoundError, storedProfile } from "@/lib/repo-profile";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const db = await getDb();
  let userId: string;
  try {
    userId = await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const body = await readJsonBody<{ repo?: unknown; draft?: unknown }>(req);
  if (!body) return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  let owner: string, name: string;
  try { [owner, name] = splitRepo(String(body.repo ?? "")); } catch {
    return Response.json({ error: "repo must be owner/name." }, { status: 400 });
  }
  let draft;
  try { draft = parseDraft(body.draft); } catch (error) {
    if (error instanceof InvalidDraftError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN;
  try {
    const profile = token ? await repoProfile(db, gh(token), `${owner}/${name}`) : await storedProfile(db, owner, name);
    if (!profile) return Response.json({ error: "No profile has been built for this repository yet. Open it on opensrcer once." }, { status: 404 });
    const checks = checkDraft(profile, draft);
    await recordEvent(db, userId, { type: "verification", repo: profile.repo, data: { check: "draft", warnings: checks.filter((c) => c.status === "warn").map((c) => c.id) } })
      .catch((e) => console.error("[harness/check] event", e));
    return Response.json({ repo: profile.repo, checks });
  } catch (error) {
    if (error instanceof RepoNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    console.error("[harness/check]", error);
    return Response.json({ error: "GitHub didn't answer in time. Try again in a minute." }, { status: 503 });
  }
}
