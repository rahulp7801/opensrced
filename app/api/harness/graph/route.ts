// POST /api/harness/graph {repo} — graphify's graph of a public repository,
// for a harness user without graphify installed (harness/server.mjs). Served
// from the shared store (lib/graph-store.ts: built once per commit for
// everyone), else built in the graph sandbox like /api/graph/generate.
// The reply is the stored record as-is: gzipped JSON {graph, html, revision}.

import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { assertUnderDailyLimit, DailyLimitError, HarnessAuthError, harnessUser, recordGraphBuild } from "@/lib/harness";
import { splitRepo } from "@/lib/ai-policy";
import { packGraph, type StoredGraph } from "@/lib/graph-worker";
import { buildSharedGraph, SharedGraphError, storedSharedGraph } from "@/lib/harness-graph";
import { cloudExecution } from "@/lib/cloud-run-state";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel caps a function's response at 4.5 MB. */
const GRAPH_REPLY_MAX = 4_400_000;

export async function POST(req: Request) {
  const db = await getDb();
  let userId: string;
  try {
    userId = await harnessUser(db, req.headers.get("authorization"), canUse);
  } catch (error) {
    if (error instanceof HarnessAuthError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const body = await readJsonBody<Record<string, unknown>>(req);
  let repo: string;
  try { repo = splitRepo(String(body?.repo ?? "")).join("/"); } catch {
    return Response.json({ error: "repo must be owner/name." }, { status: 400 });
  }
  if (cloudExecution() && (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.OPENSRCER_WORKER_SNAPSHOT_ID)) {
    return Response.json({ error: "The code map runtime is not configured on opensrcer." }, { status: 503 });
  }

  let graph: StoredGraph | null;
  try {
    graph = await storedSharedGraph(repo);
    if (!graph) {
      // Only a build costs the sandbox: it counts against the account's day (lib/harness.ts DAILY_LIMITS).
      try { await assertUnderDailyLimit(db, userId, "graph_builds"); } catch (error) {
        if (error instanceof DailyLimitError) return Response.json({ error: `${error.message} Or install graphify locally to map it on your machine.` }, { status: 429 });
        throw error;
      }
      // Counted before it runs: a build that fails or times out spent the sandbox too.
      graph = await buildSharedGraph(repo, userId, req.signal, () => recordGraphBuild(db, userId, repo));
    }
  } catch (error) {
    if (error instanceof SharedGraphError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const packed = packGraph(graph);
  if (packed.length > GRAPH_REPLY_MAX) {
    return Response.json({ error: `${repo}'s code map is too large to send (${Math.round(packed.length / 1e6)} MB). Install graphify locally for this one.` }, { status: 413 });
  }
  return new Response(new Uint8Array(packed), { headers: { "content-type": "application/gzip", "cache-control": "private, no-store" } });
}
