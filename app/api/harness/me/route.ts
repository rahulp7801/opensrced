// GET /api/harness/me — who a harness token belongs to and what's left of
// today's limits (lib/harness.ts DAILY_LIMITS), for the plugin's setup_check.
import { eq } from "drizzle-orm";
import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { dailyLimit, dailyUsage, HarnessAuthError, harnessUser } from "@/lib/harness";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await getDb();
  let userId: string;
  try {
    userId = await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const [user] = await db.select({ login: users.login }).from(users).where(eq(users.id, userId)).limit(1);
  const limit = async (kind: "lessons" | "graph_builds") => ({ used: await dailyUsage(db, userId, kind), limit: dailyLimit(kind) });
  return Response.json({ login: user?.login ?? null, today: { lessons: await limit("lessons"), new_maps: await limit("graph_builds") } }, { headers: { "Cache-Control": "private, no-store" } });
}
