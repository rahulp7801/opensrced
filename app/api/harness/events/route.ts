// POST /api/harness/events — what the harness reports, for stats (lib/harness.ts).
// Body: {"type": "pr_opened", "repo": "owner/name", "data": {...}}

import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { HarnessAuthError, HarnessInputError, harnessUser, recordEvent } from "@/lib/harness";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const db = await getDb();
  let userId: string;
  try {
    userId = await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const body = await readJsonBody(req);
  if (!body) return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  try {
    await recordEvent(db, userId, body);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof HarnessInputError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
