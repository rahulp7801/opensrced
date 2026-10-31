// GET /api/cron/record — the nightly contribution sync (PLAN §9.1), called by
// Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`, like
// /api/cron/ingest. Refreshes every open opensrcer PR (state, reviews,
// maintainer approvals, replies) and rebuilds the touched users' levels.
// Reads public PRs with OPENSRCER_INGEST_GITHUB_TOKEN; it never acts for a user.

import { getDb } from "@/lib/db/client";
import { flagEnabled } from "@/lib/flags";
import { gh } from "@/lib/gh";
import { syncContributions } from "@/lib/record/sync";
import { cronAuthorized } from "@/lib/recs/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
// Stop starting batches here so the one in flight can finish; the rest wait for tomorrow.
const BUDGET_MS = 240_000;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!flagEnabled("record")) return Response.json({ skipped: "OPENSRCER_RECORD is off" });
  const token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN;
  if (!token) return Response.json({ error: "OPENSRCER_INGEST_GITHUB_TOKEN is not set" }, { status: 503 });
  try {
    const run = await syncContributions(await getDb(), gh(token), Date.now() + BUDGET_MS);
    console.log(`[cron/record] ${run.checked} checked, ${run.changed} finished, ${run.missing.length} missing, ${run.users} users rebuilt`);
    return Response.json(run);
  } catch (error) {
    console.error("[cron/record]", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
