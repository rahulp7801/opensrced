// The signed-in user's own contribution record (PLAN §9.1-9.3), behind
// OPENSRCER_RECORD=1. Private: only ever the caller's record; no leaderboards.
//
//   GET  /api/record                       level, standing and its breakdown, PRs, open spam flags, imported history, home project
//   POST /api/record { action: "import" }  opt-in "Import my GitHub history" (public PRs only)
//   POST /api/record { action: "home", repo: "owner/name" | null }  change or clear the home project
//
// ponytail: an API until /account exists to show it (another stream builds that page).

import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { gh } from "@/lib/gh";
import { resolveCommitAuthor, resolveGitHubToken } from "@/lib/github-token";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { GitHubUserNotFoundError, importHistory } from "@/lib/record/import";
import { InvalidRepoNameError } from "@/lib/ai-policy";
import { homeChoices, homeProject, NotYourProjectError, setHomeProject } from "@/lib/record/continuity";
import { recordView, UnknownUserError } from "@/lib/record/standing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  try {
    const db = await getDb();
    const view = await recordView(db, userId);
    return json({ ...view, home: await homeProject(db, userId), homeChoices: await homeChoices(db, userId) });
  } catch (error) {
    // No record yet: nothing published or imported.
    if (error instanceof UnknownUserError) return json({ level: "newcomer", standing: 0, breakdown: {}, spamFlags: [], contributions: [], history: null, home: null, homeChoices: [] });
    throw error;
  }
}

export async function POST(req: Request) {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (body?.action === "home") {
    if (body.repo !== null && typeof body.repo !== "string") return json({ error: 'Send { "action": "home", "repo": "owner/name" } or "repo": null.' }, 400);
    try {
      return json({ home: await setHomeProject(await getDb(), userId, body.repo) });
    } catch (error) {
      if (error instanceof InvalidRepoNameError) return json({ error: error.message }, 400);
      if (error instanceof NotYourProjectError || error instanceof UnknownUserError) return json({ error: "Pick a repository from your record." }, 404);
      throw error;
    }
  }
  if (body?.action !== "import") return json({ error: 'Send { "action": "import" } or { "action": "home", "repo": ... }.' }, 400);
  const [token, author] = await Promise.all([resolveGitHubToken(), resolveCommitAuthor(req.signal).catch(() => null)]);
  if (!token || !author) return json({ error: "Sign in with GitHub again to import your history." }, 401);
  try {
    return json({ history: await importHistory(await getDb(), gh(token), { id: userId, login: author.login }) });
  } catch (error) {
    if (error instanceof GitHubUserNotFoundError) return json({ error: error.message }, 404);
    throw error;
  }
}
