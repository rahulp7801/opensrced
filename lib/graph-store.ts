import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cloudExecution } from "./cloud-run-state";
import { readJson, privateJsonOptions } from "./blob-store";
import { parseRunTarget } from "./run-target";
import { graphJsonPath, graphHtmlPath } from "./graph";
import { GRAPH_MAX_BYTES, type StoredGraph } from "./graph-worker";

function graphPath(userId: string, repo: string): string {
  if (!userId) throw new Error("Graph owner is required");
  return `users/${createHash("sha256").update(userId).digest("hex")}/graphs/${parseRunTarget(repo).repo.toLowerCase()}.json`;
}

export async function getStoredGraph(userId: string, repo: string): Promise<StoredGraph | null> {
  if (cloudExecution()) return (await readJson<StoredGraph>(graphPath(userId, repo), GRAPH_MAX_BYTES))?.value ?? null;
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  try { return { graph: JSON.parse(await readFile(graphJsonPath(owner, name), "utf8")), html: await readFile(graphHtmlPath(owner, name), "utf8"), revision: "", created_at: "" }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function saveStoredGraph(userId: string, repo: string, graph: StoredGraph): Promise<void> {
  const data = JSON.stringify(graph);
  if (Buffer.byteLength(data) > GRAPH_MAX_BYTES) throw new Error("Graph exceeds the current size limit");
  if (cloudExecution()) {
    await put(graphPath(userId, repo), data, { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(20_000) });
    return;
  }
  const [owner, name] = parseRunTarget(repo).repo.split("/");
  const jsonPath = graphJsonPath(owner, name);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(graph.graph));
  await writeFile(graphHtmlPath(owner, name), graph.html);
}
