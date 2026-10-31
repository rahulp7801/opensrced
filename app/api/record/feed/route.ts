// What /issues shows from the record (PLAN §9.5), behind OPENSRCER_RECORD=1.
// Private: only ever the caller's own.
//
//   GET  /api/record/feed                             unread "you know this code" alerts, and the "Next in <area>" card
//   POST /api/record/feed { action: "dismiss", id }   dismiss one alert ({ all: true } for every unread one)

import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { dismissAlerts, unreadAlerts, UnknownAlertError } from "@/lib/record/alerts";
import { nextInArea } from "@/lib/record/continuity";
import { UnknownUserError } from "@/lib/record/standing";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const db = await getDb();
  let next = null;
  try { next = await nextInArea(db, userId); }
  catch (error) {
    // No record yet: nothing merged, so no card.
    if (!(error instanceof UnknownUserError)) throw error;
  }
  return json({ alerts: await unreadAlerts(db, userId), next });
}

export async function POST(req: Request) {
  if (!flagEnabled("record")) return json({ error: "not found" }, 404);
  const userId = await sessionUserId();
  if (!userId) return json({ error: "Not authenticated" }, 401);
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (body?.action !== "dismiss" || (body.all !== true && typeof body.id !== "number")) {
    return json({ error: 'Send { "action": "dismiss", "id": <alert id> } or { "action": "dismiss", "all": true }.' }, 400);
  }
  try {
    return json({ dismissed: await dismissAlerts(await getDb(), userId, body.all === true ? "all" : body.id as number) });
  } catch (error) {
    if (error instanceof UnknownAlertError) return json({ error: "No such alert." }, 404);
    throw error;
  }
}
