import { createHash } from "node:crypto";
import { BlobNotFoundError, get, head, put } from "@vercel/blob";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cloudExecution } from "./cloud-run-state";
import { privateJsonOptions } from "./blob-store";
import { parseRunTarget } from "./run-target";
import { graphJsonPath, graphHtmlPath } from "./graph";
import { GRAPH_JSON_MAX_BYTES, GRAPH_MAX_BYTES, packGraph, parseStoredGraph, unpackGraph, type StoredGraph } from "./graph-worker";

function graphPath(userId: string, repo: string): string {
  if (!userId) throw new Error("Graph owner is required");
  return `users/${createHash("sha256").update(userId).digest("hex")}/graphs/${parseRunTarget(repo).repo.toLowerCase()}.json.gz`;
}

// A Django-size graph costs ~0.3 s to unzip and parse plus a 3 MB download, so
// a warm instance keeps the last one and revalidates it by ETag (a 304 carries
// no body). Callers only read it (graph.ts sorts copies), so sharing is safe.
// ponytail: one entry bounds memory (~200 MB for Django); key by path with a
// small LRU if concurrent users on one instance start thrashing it.
let lastGraph: { path: string; etag: string; graph: StoredGraph } | undefined;

export async function getStoredGraph(userId: string, repo: string): Promise<StoredGraph | null> {
  if (cloudExecution()) {
    const path = graphPath(userId, repo);
    const cached = lastGraph?.path === path ? lastGraph : undefined;
    const blob = await get(path, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(30_000), ...(cached ? { ifNoneMatch: cached.etag } : {}) });
    if (blob?.statusCode === 304 && cached) return cached.graph;
    if (!blob || blob.statusCode !== 200) return null;
    if (blob.blob.size > GRAPH_MAX_BYTES) throw new Error("Stored graph exceeds size limit");
    const graph = unpackGraph(Buffer.from(await new Response(blob.stream).arrayBuffer()));
    lastGraph = { path, etag: blob.blob.etag, graph };
    return graph;
  }
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  try { return parseStoredGraph({ graph: JSON.parse(await readFile(graphJsonPath(owner, name), "utf8")), html: await readFile(graphHtmlPath(owner, name), "utf8"), revision: "", created_at: "" }, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Existence check without downloading or parsing the graph. */
export async function hasStoredGraph(userId: string, repo: string): Promise<boolean> {
  if (cloudExecution()) {
    try { await head(graphPath(userId, repo), { abortSignal: AbortSignal.timeout(15_000) }); return true; }
    catch (error) { if (error instanceof BlobNotFoundError) return false; throw error; }
  }
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  return existsSync(graphJsonPath(owner, name)) && existsSync(graphHtmlPath(owner, name));
}

export async function saveStoredGraph(userId: string, repo: string, graph: StoredGraph): Promise<void> {
  if (cloudExecution()) {
    await put(graphPath(userId, repo), packGraph(graph), { ...privateJsonOptions, contentType: "application/gzip", allowOverwrite: true, abortSignal: AbortSignal.timeout(30_000) });
    return;
  }
  graph = parseStoredGraph(graph);
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  const jsonPath = graphJsonPath(owner, name);
  // The MCP server reads this file and refuses anything over the same cap.
  const json = Buffer.from(JSON.stringify(graph.graph));
  if (json.length > GRAPH_JSON_MAX_BYTES) throw new Error("Graph exceeds the current size limit");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, json);
  await writeFile(graphHtmlPath(owner, name), graph.html);
}
