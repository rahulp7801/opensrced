import { execFile } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { gitAuthArgs } from "./git-auth";
import type { GraphData, GraphEdge, GraphNode } from "./graph";

const exec = promisify(execFile);
export type StoredGraph = { graph: GraphData; html: string; revision: string; created_at: string };
export const GRAPH_MAX_BYTES = 8_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validNode(value: unknown): value is GraphNode {
  return record(value)
    && typeof value.id === "string"
    && typeof value.label === "string"
    && Number.isSafeInteger(value.community)
    && typeof value.file_type === "string"
    && typeof value.source_file === "string"
    && optionalString(value.source_location)
    && optionalString(value.norm_label);
}

function validEdge(value: unknown): value is GraphEdge {
  return record(value)
    && typeof value.source === "string"
    && typeof value.target === "string"
    && typeof value.relation === "string"
    && typeof value.confidence === "string"
    && typeof value.confidence_score === "number"
    && Number.isFinite(value.confidence_score)
    && typeof value.source_file === "string"
    && optionalString(value.source_location)
    && (value.weight === undefined || (typeof value.weight === "number" && Number.isFinite(value.weight)));
}

export function parseStoredGraph(value: unknown, allowEmptyMetadata = false): StoredGraph {
  if (!record(value) || !record(value.graph)
    || !Array.isArray(value.graph.nodes) || !value.graph.nodes.every(validNode)
    || !Array.isArray(value.graph.links) || !value.graph.links.every(validEdge)
    || (value.graph.hyperedges !== undefined && !Array.isArray(value.graph.hyperedges))
    || typeof value.html !== "string" || Buffer.byteLength(value.html) > 2_000_000
    || typeof value.revision !== "string" || (!/^[0-9a-f]{40}$/i.test(value.revision) && !(allowEmptyMetadata && value.revision === ""))
    || typeof value.created_at !== "string" || (!Number.isFinite(Date.parse(value.created_at)) && !(allowEmptyMetadata && value.created_at === ""))) {
    throw new Error("Invalid graph output.");
  }
  if (Buffer.byteLength(JSON.stringify(value.graph)) > 4_000_000 || Buffer.byteLength(JSON.stringify(value)) > GRAPH_MAX_BYTES) {
    throw new Error("Graph exceeds the current size limit.");
  }
  return value as StoredGraph;
}

async function readLimited(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, "r");
  try {
    if ((await file.stat()).size > maxBytes) throw new Error("Graph exceeds the current size limit.");
    return file.readFile("utf8");
  } finally {
    await file.close();
  }
}

export async function buildGraphWorker(repo: string, token: string | null, signal?: AbortSignal, progress: (message: string) => void = () => {}): Promise<StoredGraph> {
  const root = await mkdtemp(join(tmpdir(), "opensrcer-graph-"));
  const source = join(root, "repo");
  const output = join(root, "output");
  const env = childEnv({ GRAPHIFY_OUT: output });
  try {
    progress("Cloning repository...");
    await exec("git", [...gitAuthArgs(token), "clone", "--depth=1", `https://github.com/${repo}.git`, source], { env, signal, timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
    const { stdout } = await exec("git", ["-C", source, "rev-parse", "HEAD"], { env, signal, timeout: 10_000, windowsHide: true });
    // Never let repository links redirect the parser to host files. The clone is disposable.
    const { stdout: entries } = await exec("git", ["-C", source, "ls-files", "--stage", "-z"], { env, signal, timeout: 30_000, maxBuffer: 10_000_000, windowsHide: true });
    for (const entry of entries.split("\0")) {
      if (!entry.startsWith("120000 ")) continue;
      const target = resolve(source, entry.slice(entry.indexOf("\t") + 1));
      const rel = relative(source, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Unsafe source link path");
      await rm(target, { force: true });
    }
    progress("Parsing source and building graph...");
    // Isolated Python import mode prevents a repository's graphify.py from
    // shadowing the installed package. No provider or GitHub key enters Python.
    await exec(process.env.OPENSRCER_GRAPH_PYTHON || "python", ["-I", "-m", "graphify", "update", "."], { cwd: source, env, signal, timeout: 180_000, maxBuffer: 1_000_000, windowsHide: true });
    const jsonPath = join(output, "graph.json");
    const htmlPath = join(output, "graph.html");
    const graph = JSON.parse(await readLimited(jsonPath, 4_000_000)) as GraphData;
    const result = { graph, html: await readLimited(htmlPath, 2_000_000), revision: stdout.trim(), created_at: new Date().toISOString() };
    return parseStoredGraph(result);
  } finally { await rm(root, { recursive: true, force: true }); }
}
