// A public repository's code map for the harness, built in the graph sandbox when it
// isn't stored yet. Used by the plugin's map route (app/api/harness/graph) and by admins
// preparing a class's repos before a lecture (app/api/admin/classes/maps).
//
// Stored in Postgres (shared_graphs), with build slots leased there too (cloud_leases):
// Blob's quota ran out in Nov 2026 and took every map with it. Maps built before that
// are still read from Blob (lib/graph-store.ts) when it answers, and new ones are copied
// there when it does.

import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gt, like, lt } from "drizzle-orm";
import { cloudExecution } from "./cloud-run-state";
import { buildCloudGraph } from "./cloud-graph";
import { buildGraphWorker, packGraph, unpackGraph, type StoredGraph } from "./graph-worker";
import { getSharedGraph, saveStoredGraph } from "./graph-store";
import { CapacityError, reserveSlot } from "./concurrency";
import { getDb, type Db } from "./db/client";
import { cloudLeases, sharedGraphs } from "./db/schema";
import { parseRunTarget } from "./run-target";

/** Why a map couldn't be had, with the status and words for the caller. */
export class SharedGraphError extends Error {
  constructor(readonly status: 429 | 502 | 503, message: string) { super(message); }
}

/** Builds running at once, across every account; each account may hold one. */
export const GRAPH_SLOTS = 2;
const LEASE_MS = 5.5 * 60_000;

const repoKey = (repo: string) => parseRunTarget(repo).repo.toLowerCase();

/** The stored map, or null. Postgres first, then Blob. Throws SharedGraphError(503)
 *  only when neither can be read; a Blob outage alone means "not stored" (it's rebuilt into Postgres). */
export async function storedSharedGraph(repo: string, db?: Db, readBlob = getSharedGraph): Promise<StoredGraph | null> {
  let postgresDown = false;
  try {
    const [row] = await (db ?? await getDb()).select({ data: sharedGraphs.data }).from(sharedGraphs).where(eq(sharedGraphs.repo, repoKey(repo)));
    if (row) return unpackGraph(row.data);
  } catch (error) {
    console.error("[harness-graph] read (postgres)", error);
    postgresDown = true;
  }
  try { return await readBlob(repo); } catch (error) {
    console.error("[harness-graph] read (blob)", error);
    if (postgresDown) throw new SharedGraphError(503, "Graph storage is unavailable. Try again later.");
    return null;
  }
}

/** One of GRAPH_SLOTS build leases, one per account. Returns its release. Exported for tests. */
export async function reserveGraphSlot(db: Db, ownerId: string, now = () => new Date()): Promise<() => Promise<void>> {
  const id = randomUUID();
  const owner = createHash("sha256").update(`cloud-slot\n${ownerId}`).digest("hex").slice(0, 32);
  const held = async () => (await db.select({ n: count() }).from(cloudLeases)
    .where(and(eq(cloudLeases.owner, owner), gt(cloudLeases.expires, now()), like(cloudLeases.key, "graph/%"))))[0]?.n ?? 0;
  const busyOwner = () => new CapacityError("You already have a code map building. Retry when it finishes.");
  if (await held() > 0) throw busyOwner();
  for (let slot = 0; slot < GRAPH_SLOTS; slot++) {
    const key = `graph/${slot}`;
    // Takes the slot if it's free or its lease ran out; returns nothing if someone holds it.
    const [got] = await db.insert(cloudLeases).values({ key, id, owner, expires: new Date(now().getTime() + LEASE_MS) })
      .onConflictDoUpdate({ target: cloudLeases.key, set: { id, owner, expires: new Date(now().getTime() + LEASE_MS) }, setWhere: lt(cloudLeases.expires, now()) })
      .returning({ id: cloudLeases.id });
    if (got?.id !== id) continue;
    const release = async () => { await db.delete(cloudLeases).where(and(eq(cloudLeases.key, key), eq(cloudLeases.id, id))); };
    // Two requests from one account can both pass the first check: whoever then sees two backs out.
    if (await held() > 1) { await release(); throw busyOwner(); }
    return release;
  }
  throw new CapacityError("All map builders are busy. Please retry when a build finishes.");
}

/** Builds and stores the map of a public repository. `beforeBuild` runs once a
 *  build slot is held (the plugin route counts the build there). */
export async function buildSharedGraph(repo: string, ownerId: string, abort?: AbortSignal, beforeBuild: () => Promise<void> = async () => {}): Promise<StoredGraph> {
  const db = await getDb();
  let release: () => void | Promise<void>;
  try { release = cloudExecution() ? await reserveGraphSlot(db, ownerId) : reserveSlot("graph", GRAPH_SLOTS); }
  catch (error) {
    if (error instanceof CapacityError) throw new SharedGraphError(429, `${error.message} Try again in a few minutes.`);
    throw error;
  }
  const signal = AbortSignal.any([...(abort ? [abort] : []), AbortSignal.timeout(260_000)]);
  // The cloud build frees the slot itself, once its sandbox has really stopped (one that
  // won't stop keeps the slot until the lease runs out). Until then, it's ours to free.
  let handedOver = false;
  try {
    await beforeBuild();
    // No token: only a public repository clones, so only public graphs are shared.
    let graph: StoredGraph;
    if (cloudExecution()) { handedOver = true; graph = await buildCloudGraph(repo, null, signal, () => {}, release); }
    else graph = await buildGraphWorker(repo, null, signal);
    const row = { repo: repoKey(repo), revision: graph.revision.toLowerCase(), data: packGraph(graph), updatedAt: new Date() };
    await db.insert(sharedGraphs).values(row).onConflictDoUpdate({ target: sharedGraphs.repo, set: row });
    // The older store (and, locally, the files the MCP server reads): a copy, never the reason a build fails.
    await saveStoredGraph(ownerId, repo, graph, "public").catch((error: unknown) => console.error("[harness-graph] copy to the graph store", error));
    return graph;
  } catch (error) {
    console.error("[harness-graph] build", error);
    throw new SharedGraphError(502, signal.aborted ? "Building the code map took too long for this repository." : `Couldn't build a code map of ${repo}. It must be a public GitHub repository.`);
  } finally {
    if (!handedOver) await Promise.resolve(release()).catch((error: unknown) => console.error("[harness-graph] release build slot", error));
  }
}
