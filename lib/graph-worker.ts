import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { gitAuthArgs } from "./git-auth";
import type { GraphData } from "./graph";

const exec = promisify(execFile);
export type StoredGraph = { graph: GraphData; html: string; revision: string; created_at: string };
export const GRAPH_MAX_BYTES = 8_000_000;

export async function buildGraphWorker(repo: string, token: string | null, signal?: AbortSignal, progress: (message: string) => void = () => {}): Promise<StoredGraph> {
  const root = await mkdtemp(join(tmpdir(), "opensrcer-graph-"));
  const source = join(root, "repo");
  const env = childEnv();
  try {
    progress("Cloning repository...");
    await exec("git", [...gitAuthArgs(token), "clone", "--depth=1", `https://github.com/${repo}.git`, source], { env, signal, timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
    const { stdout } = await exec("git", ["-C", source, "rev-parse", "HEAD"], { env, signal, timeout: 10_000, windowsHide: true });
    progress("Parsing source and building graph...");
    // Isolated Python import mode prevents a repository's graphify.py from
    // shadowing the installed package. No provider or GitHub key enters Python.
    await exec(process.env.OPENSRCER_GRAPH_PYTHON || "python", ["-I", "-m", "graphify", "update", "."], { cwd: source, env, signal, timeout: 180_000, maxBuffer: 1_000_000, windowsHide: true });
    const jsonPath = join(source, "graphify-out", "graph.json");
    const htmlPath = join(source, "graphify-out", "graph.html");
    if ((await stat(jsonPath)).size > 4_000_000 || (await stat(htmlPath)).size > 2_000_000) throw new Error("Graph exceeds the current size limit.");
    const graph = JSON.parse(await readFile(jsonPath, "utf8")) as GraphData;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error("Invalid graph output.");
    const result = { graph, html: await readFile(htmlPath, "utf8"), revision: stdout.trim(), created_at: new Date().toISOString() };
    if (Buffer.byteLength(JSON.stringify(result)) > GRAPH_MAX_BYTES) throw new Error("Graph exceeds the current size limit.");
    return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}
