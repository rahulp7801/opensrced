// POST /api/harness/graph {repo} — graphify's graph of a public repository,
// for a harness user without graphify installed (harness/server.mjs). Served
// from the shared store (lib/graph-store.ts: built once per commit for
// everyone), else built in the graph sandbox like /api/graph/generate.
// The reply is the stored record as-is: gzipped JSON {graph, html, revision}.

import { canUse } from "@/lib/access-server";
import { getDb } from "@/lib/db/client";
import { HarnessAuthError, harnessUser } from "@/lib/harness";
import { splitRepo } from "@/lib/ai-policy";
import { cloudExecution } from "@/lib/cloud-run-state";
import { buildCloudGraph } from "@/lib/cloud-graph";
import { buildGraphWorker, packGraph, type StoredGraph } from "@/lib/graph-worker";
import { getSharedGraph, saveStoredGraph } from "@/lib/graph-store";
import { reserveCloudSlot } from "@/lib/cloud-capacity";
import { CapacityError, reserveSlot } from "@/lib/concurrency";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel caps a function's response at 4.5 MB. */
export const GRAPH_REPLY_MAX = 4_400_000;

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
  try { graph = await getSharedGraph(repo); } catch (error) {
    console.error("[harness/graph] read", error);
    return Response.json({ error: "Graph storage is unavailable. Try again later, or install graphify locally." }, { status: 503 });
  }
  if (!graph) {
    // ponytail: the shared store and 2 build slots are the only spend limits; add a per-account daily cap if usage grows.
    let release: () => void | Promise<void>;
    try { release = cloudExecution() ? await reserveCloudSlot("graph", 2, 5.5 * 60_000, userId) : reserveSlot("graph", 2); }
    catch (error) {
      if (error instanceof CapacityError) return Response.json({ error: `${error.message} Try again in a few minutes.` }, { status: 429 });
      throw error;
    }
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(260_000)]);
    try {
      // No token: only a public repository clones, so only public graphs reach the shared store.
      graph = cloudExecution() ? await buildCloudGraph(repo, null, signal, () => {}, release) : await buildGraphWorker(repo, null, signal);
      await saveStoredGraph(userId, repo, graph, "public");
    } catch (error) {
      console.error("[harness/graph] build", error);
      return Response.json({ error: signal.aborted ? "Building the code map took too long for this repository." : `Couldn't build a code map of ${repo}. It must be a public GitHub repository.` }, { status: 502 });
    } finally {
      if (!cloudExecution()) await Promise.resolve(release()).catch(() => {});
    }
  }
  const packed = packGraph(graph);
  if (packed.length > GRAPH_REPLY_MAX) {
    return Response.json({ error: `${repo}'s code map is too large to send (${Math.round(packed.length / 1e6)} MB). Install graphify locally for this one.` }, { status: 413 });
  }
  return new Response(new Uint8Array(packed), { headers: { "content-type": "application/gzip", "cache-control": "private, no-store" } });
}
