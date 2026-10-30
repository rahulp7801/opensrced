import { createHash } from "node:crypto";
import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, stat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudExecution } from "./cloud-run-state";
import { privateJsonOptions, readJson } from "./blob-store";
import { parseRunTarget } from "./run-target";
import { graphCacheDir, graphJsonPath, graphHtmlPath } from "./graph";
import { GRAPH_JSON_MAX_BYTES, GRAPH_MAX_BYTES, packGraph, parseStoredGraph, unpackGraph, type StoredGraph } from "./graph-worker";

function graphPrefix(userId: string): string {
  if (!userId) throw new Error("Graph owner is required");
  return `users/${createHash("sha256").update(userId).digest("hex")}/graphs/`;
}

function graphPath(userId: string, repo: string): string {
  return `${graphPrefix(userId)}${parseRunTarget(repo).repo.toLowerCase()}.json.gz`;
}

/** Graphs an account keeps. Each can be tens of MB, and nothing else ever
 *  removes them, so without a cap one account could fill the store. */
export const GRAPHS_PER_ACCOUNT = 20;

/** The stored graphs to delete so only the newest `keep` remain. Exported for tests. */
export function staleGraphPaths(blobs: Array<{ pathname: string; uploadedAt: Date }>, keep = GRAPHS_PER_ACCOUNT): string[] {
  return [...blobs].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()).slice(keep).map((blob) => blob.pathname);
}

// A Django-size graph costs ~0.3 s to unzip and parse plus a 3 MB download, so
// a warm instance keeps the last one and revalidates it by ETag (a 304 carries
// no body). Callers only read it (graph.ts sorts copies), so sharing is safe.
// ponytail: one entry bounds memory (~200 MB for Django); key by path with a
// small LRU if concurrent users on one instance start thrashing it.
let lastGraph: { path: string; etag: string; graph: StoredGraph } | undefined;

async function readBlobGraph(path: string): Promise<StoredGraph | null> {
  const cached = lastGraph?.path === path ? lastGraph : undefined;
  const blob = await get(path, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(30_000), ...(cached ? { ifNoneMatch: cached.etag } : {}) });
  if (blob?.statusCode === 304 && cached) return cached.graph;
  if (!blob || blob.statusCode !== 200) return null;
  if (blob.blob.size > GRAPH_MAX_BYTES) throw new Error("Stored graph exceeds size limit");
  const graph = unpackGraph(Buffer.from(await new Response(blob.stream).arrayBuffer()));
  lastGraph = { path, etag: blob.blob.etag, graph };
  return graph;
}

// ── Shared graphs (PLAN.md §4.2 F3) ──────────────────────────────────
// A public repository's graph is the same for everyone, so it is built once
// per commit and reused across accounts, lessons and recommendations:
// graphs/<owner>/<repo>/<sha>.json.gz, plus a latest.json pointer naming the
// newest commit. The pointer keeps a read at two plain gets; listing the
// prefix instead would spend a Blob advanced operation on every graph view.
// Locally the same layout lives under ~/.opensrcer/graph-cache/graphs/.
// Private repositories never reach this path; they keep the per-account one.

/** Commits a public repository keeps in the shared store. */
export const GRAPHS_PER_REPO = 3;

const SHA = /^[0-9a-f]{40}$/i;

function sharedGraphPrefix(repo: string): string {
  return `graphs/${parseRunTarget(repo).repo.toLowerCase()}/`;
}

export function sharedGraphPath(owner: string, repo: string, sha: string): string {
  if (!SHA.test(sha)) throw new Error("A shared graph needs a full commit SHA");
  return `${sharedGraphPrefix(`${owner}/${repo}`)}${sha.toLowerCase()}.json.gz`;
}

/** The on-disk twin of a shared Blob path. Exported for tests. */
export function localSharedPath(path: string): string {
  return join(dirname(graphCacheDir("_", "_")), ...path.split("/"));
}

function enoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function latestSharedRevision(prefix: string): Promise<string | null> {
  let pointer: unknown;
  if (cloudExecution()) pointer = (await readJson<unknown>(`${prefix}latest.json`, 1_000))?.value;
  else {
    try { pointer = JSON.parse(await readFile(localSharedPath(`${prefix}latest.json`), "utf8")); }
    catch (error) { if (enoent(error)) return null; throw error; }
  }
  if (pointer === undefined) return null;
  const revision = (pointer as { revision?: unknown } | null)?.revision;
  if (typeof revision !== "string" || !SHA.test(revision)) throw new Error("Invalid shared graph pointer");
  return revision;
}

/** A public repository's shared graph: at `sha` when given, else its newest commit. */
export async function getSharedGraph(repo: string, sha?: string): Promise<StoredGraph | null> {
  const revision = sha ?? await latestSharedRevision(sharedGraphPrefix(repo));
  if (!revision) return null;
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  const path = sharedGraphPath(owner, name, revision);
  if (cloudExecution()) return readBlobGraph(path);
  try { return unpackGraph(await readFile(localSharedPath(path))); }
  catch (error) { if (enoent(error)) return null; throw error; }
}

async function saveSharedGraph(repo: string, graph: StoredGraph): Promise<void> {
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  const prefix = sharedGraphPrefix(repo);
  const path = sharedGraphPath(owner, name, graph.revision);
  const pointer = JSON.stringify({ revision: graph.revision.toLowerCase() });
  const data = packGraph(graph);
  if (cloudExecution()) {
    await put(path, data, { ...privateJsonOptions, contentType: "application/gzip", allowOverwrite: true, abortSignal: AbortSignal.timeout(30_000) });
    await put(`${prefix}latest.json`, pointer, { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
    // Cleanup never fails the save that triggered it.
    await list({ prefix, limit: 100, abortSignal: AbortSignal.timeout(8_000) })
      .then(({ blobs }) => staleGraphPaths(blobs.filter((blob) => blob.pathname.endsWith(".json.gz")), GRAPHS_PER_REPO))
      .then((stale) => stale.length ? del(stale, { abortSignal: AbortSignal.timeout(8_000) }) : undefined)
      .catch(() => {});
    return;
  }
  const dir = localSharedPath(prefix);
  await mkdir(dir, { recursive: true });
  await writeFile(localSharedPath(path), data);
  await writeFile(localSharedPath(`${prefix}latest.json`), pointer);
  await readdir(dir)
    .then((files) => Promise.all(files.filter((file) => file.endsWith(".json.gz")).map(async (file) => ({ pathname: join(dir, file), uploadedAt: (await stat(join(dir, file))).mtime }))))
    .then((files) => Promise.all(staleGraphPaths(files, GRAPHS_PER_REPO).map((file) => rm(file, { force: true }))))
    .catch(() => {});
}

/** Readers try the shared graph first; a private repository (or a public one
 *  built before graphs were shared) falls back to the caller's own copy. */
export async function getStoredGraph(userId: string, repo: string): Promise<StoredGraph | null> {
  const shared = await getSharedGraph(repo);
  if (shared) return shared;
  if (cloudExecution()) return readBlobGraph(graphPath(userId, repo));
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  try { return parseStoredGraph({ graph: JSON.parse(await readFile(graphJsonPath(owner, name), "utf8")), html: await readFile(graphHtmlPath(owner, name), "utf8"), revision: "", created_at: "" }, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Existence check without downloading or parsing the graph. */
export async function hasStoredGraph(userId: string, repo: string): Promise<boolean> {
  if (await latestSharedRevision(sharedGraphPrefix(repo))) return true;
  if (cloudExecution()) {
    try { await head(graphPath(userId, repo), { abortSignal: AbortSignal.timeout(15_000) }); return true; }
    catch (error) { if (error instanceof BlobNotFoundError) return false; throw error; }
  }
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  return existsSync(graphJsonPath(owner, name)) && existsSync(graphHtmlPath(owner, name));
}

/** `access` is the repository's GitHub visibility: a public repository's
 *  graph goes to the shared store, a private one stays with its account. */
export async function saveStoredGraph(userId: string, repo: string, graph: StoredGraph, access: "public" | "private"): Promise<void> {
  if (access === "public") {
    await saveSharedGraph(repo, graph);
    // Locally the MCP server reads the unpacked graph.json below, so a public
    // repository still gets it; hosted, the shared copy is the only one.
    if (cloudExecution()) return;
  }
  if (cloudExecution()) {
    await put(graphPath(userId, repo), packGraph(graph), { ...privateJsonOptions, contentType: "application/gzip", allowOverwrite: true, abortSignal: AbortSignal.timeout(30_000) });
    // Cleanup never fails the save that triggered it.
    await list({ prefix: graphPrefix(userId), limit: 1000, abortSignal: AbortSignal.timeout(8_000) })
      .then(({ blobs }) => staleGraphPaths(blobs))
      .then((stale) => stale.length ? del(stale, { abortSignal: AbortSignal.timeout(8_000) }) : undefined)
      .catch(() => {});
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
