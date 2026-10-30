// GET /api/cron/ingest — the nightly catalog ingest (PLAN.md §6.1), called by
// Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`.
// Middleware leaves this path public; the secret is the only gate.
// Reads public issues with OPENSRCER_INGEST_GITHUB_TOKEN, a server token that
// never acts for a user (a GitHub App installation token once the App exists).

import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { gh } from "@/lib/gh";
import { cronAuthorized, ingestCatalog } from "@/lib/recs/ingest";

export const dynamic = "force-dynamic";
// Hobby with Fluid compute allows 300 s; stop starting repos at 240 s so the
// one in flight can finish. The rest continue tomorrow, oldest first.
export const maxDuration = 300;
const BUDGET_MS = 240_000;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!flagEnabled("recs")) return Response.json({ skipped: "OPENSRCER_RECS is off" });
  const token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN;
  if (!token) return Response.json({ error: "OPENSRCER_INGEST_GITHUB_TOKEN is not set" }, { status: 503 });
  try {
    const run = await ingestCatalog(await getDb(), gh(token), Date.now() + BUDGET_MS);
    // Vercel keeps function logs; one line per run is the ingest's record.
    console.log(`[cron/ingest] ${run.results.length} ingested, ${run.failed.length} failed, ${run.remaining} left`);
    return Response.json(run, { status: run.failed.length && !run.results.length ? 502 : 200 });
  } catch (error) {
    console.error("[cron/ingest]", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
