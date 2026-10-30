// GET /api/recs?feed=for-you|continue|explore&language=python&max_difficulty=3&testable=1&limit=20
// Recommended issues from the catalog (PLAN.md §6.4), behind OPENSRCER_RECS.
//   for-you   personalised: level, GitHub languages, known code, repo health
//   continue  per repo whose code the user already knows (map_coverage)
//   explore   the same catalog through filters only, no personal signals

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { gh } from "@/lib/gh";
import { resolveGitHubToken } from "@/lib/github-token";
import { FEEDS, loadUser, recommend, userLanguages, type Feed } from "@/lib/recs/rank";
import { sessionUserId } from "@/lib/require-session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!flagEnabled("recs")) return Response.json({ error: "Not found" }, { status: 404 });
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const feed = (sp.get("feed") ?? "for-you") as Feed;
  const language = sp.get("language")?.trim() || undefined;
  const maxDifficulty = sp.has("max_difficulty") ? Number(sp.get("max_difficulty")) : undefined;
  const take = Number(sp.get("limit") ?? 20);
  if (!FEEDS.includes(feed) || (language !== undefined && !/^[\w+#. -]{1,40}$/.test(language))
      || (maxDifficulty !== undefined && (!Number.isInteger(maxDifficulty) || maxDifficulty < 1 || maxDifficulty > 5))
      || !Number.isInteger(take) || take < 1 || take > 50) {
    return Response.json({ error: "Invalid feed, language, max_difficulty (1–5) or limit (1–50)." }, { status: 400 });
  }

  try {
    const db = await getDb();
    let languages: string[] = [];
    if (feed === "for-you") {
      const token = await resolveGitHubToken();
      // Languages only sharpen the ranking; without a token the feed still works.
      if (token) languages = await userLanguages(gh(token)).catch((error: unknown) => {
        console.error("[recs] GitHub languages unavailable:", error instanceof Error ? error.message : error);
        return [];
      });
    }
    const user = await loadUser(db, userId, languages);
    const result = await recommend(db, feed, user, { language, maxDifficulty, testableOnly: sp.get("testable") === "1", take });
    return Response.json({ ...result, level: user.level }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[recs]", error);
    return Response.json({ error: "Recommendations are unavailable right now." }, { status: 503 });
  }
}
