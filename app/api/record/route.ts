// The signed-in user's own contribution record (PLAN §9.1-9.3), behind
// OPENSRCER_RECORD=1. Private: only ever the caller's record; no leaderboards.
//
//   GET  /api/record                       level, standing and its breakdown, PRs, open spam flags, imported history
//   POST /api/record { action: "import" }  opt-in "Import my GitHub history" (public PRs only)
//   POST /api/record { action: "profile", public: boolean }  the opt-in public profile at /u/<login>
//
// ponytail: an API until /account exists to show it (another stream builds that page).

import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { gh } from "@/lib/gh";
import { resolveCommitAuthor, resolveGitHubToken } from "@/lib/github-token";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { GitHubUserNotFoundError, importHistory } from "@/lib/record/import";
import { setPublicProfile } from "@/lib/record/profile";
import { recordView, UnknownUserError } from "@/lib/record/standing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  try {
    return json(await recordView(await getDb(), userId));
  } catch (error) {
    // No record yet: nothing published or imported.
    if (error instanceof UnknownUserError) return json({ level: "newcomer", standing: 0, breakdown: {}, spamFlags: [], contributions: [], history: null, publicProfile: false });
    throw error;
  }
}

export async function POST(req: Request) {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (body?.action === "profile" && typeof body.public !== "boolean") return json({ error: 'Send { "action": "profile", "public": true or false }.' }, 400);
  if (body?.action !== "import" && body?.action !== "profile") return json({ error: 'Send { "action": "import" } or { "action": "profile", "public": … }.' }, 400);
  const [token, author] = await Promise.all([resolveGitHubToken(), resolveCommitAuthor(req.signal).catch(() => null)]);
  if (!token || !author) return json({ error: `Sign in with GitHub again to ${body.action === "import" ? "import your history" : "change your profile"}.` }, 401);
  if (body.action === "profile") {
    // The login is GitHub's, read now: /u/<login> is found by it.
    await setPublicProfile(await getDb(), userId, author.login, body.public as boolean);
    return json({ publicProfile: body.public, url: body.public ? `/u/${author.login}` : null });
  }
  try {
    return json({ history: await importHistory(await getDb(), gh(token), { id: userId, login: author.login }) });
  } catch (error) {
    if (error instanceof GitHubUserNotFoundError) return json({ error: error.message }, 404);
    throw error;
  }
}
