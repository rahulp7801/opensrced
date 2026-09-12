import { execFile } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { gitAuthArgs } from "./git-auth";
import type { GraphData } from "./graph";

const exec = promisify(execFile);
export type StoredGraph = { graph: GraphData; html: string; revision: string; created_at: string };
export const GRAPH_MAX_BYTES = 8_000_000;

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
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error("Invalid graph output.");
    const result = { graph, html: await readLimited(htmlPath, 2_000_000), revision: stdout.trim(), created_at: new Date().toISOString() };
    if (Buffer.byteLength(JSON.stringify(result)) > GRAPH_MAX_BYTES) throw new Error("Graph exceeds the current size limit.");
    return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}
