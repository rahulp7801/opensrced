// A public repository's code map in the shared store (lib/graph-store.ts),
// built in the graph sandbox when it isn't there yet. Used by the plugin's
// map route (app/api/harness/graph) and by admins preparing a class's repos
// before a lecture (app/api/admin/classes/maps), so students start at once.

import { cloudExecution } from "./cloud-run-state";
import { buildCloudGraph } from "./cloud-graph";
import { buildGraphWorker, type StoredGraph } from "./graph-worker";
import { getSharedGraph, saveStoredGraph } from "./graph-store";
import { reserveCloudSlot } from "./cloud-capacity";
import { CapacityError, reserveSlot } from "./concurrency";

/** Why a map couldn't be had, with the status and words for the caller. */
export class SharedGraphError extends Error {
  constructor(readonly status: 429 | 502 | 503, message: string) { super(message); }
}

/** The stored map, or null. Throws SharedGraphError(503) when storage can't be read. */
export async function storedSharedGraph(repo: string): Promise<StoredGraph | null> {
  try { return await getSharedGraph(repo); } catch (error) {
    console.error("[harness-graph] read", error);
    throw new SharedGraphError(503, "Graph storage is unavailable. Try again later, or install graphify locally.");
  }
}

/** Builds and stores the map of a public repository. `beforeBuild` runs once a
 *  build slot is held (the plugin route counts the build there). */
export async function buildSharedGraph(repo: string, ownerId: string, abort?: AbortSignal, beforeBuild: () => Promise<void> = async () => {}): Promise<StoredGraph> {
  let release: () => void | Promise<void>;
  try { release = cloudExecution() ? await reserveCloudSlot("graph", 2, 5.5 * 60_000, ownerId) : reserveSlot("graph", 2); }
  catch (error) {
    if (error instanceof CapacityError) throw new SharedGraphError(429, `${error.message} Try again in a few minutes.`);
    throw error;
  }
  const signal = AbortSignal.any([...(abort ? [abort] : []), AbortSignal.timeout(260_000)]);
  try {
    await beforeBuild();
    // No token: only a public repository clones, so only public graphs reach the shared store.
    const graph = cloudExecution() ? await buildCloudGraph(repo, null, signal, () => {}, release) : await buildGraphWorker(repo, null, signal);
    await saveStoredGraph(ownerId, repo, graph, "public");
    return graph;
  } catch (error) {
    console.error("[harness-graph] build", error);
    throw new SharedGraphError(502, signal.aborted ? "Building the code map took too long for this repository." : `Couldn't build a code map of ${repo}. It must be a public GitHub repository.`);
  } finally {
    if (!cloudExecution()) await Promise.resolve(release()).catch(() => {});
  }
}
