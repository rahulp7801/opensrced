// Lightweight graph query functions for the MCP server.
// Reads graphify's graph.json and performs pure JS traversal.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface GraphNode {
  id: string;
  label: string;
  community: number;
  file_type: string;
  source_file: string;
  source_location?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
  source_file: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

const CALL_RELATIONS = new Set([
  "calls", "imports", "imports_from", "instantiates",
  "references", "uses_component", "binds_method",
]);

function findGraphJson(repo: string): string | null {
  // Parse owner/name
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+)$/i.exec(
    repo.trim().replace(/\.git$/i, ""),
  );
  if (!m) return null;
  const [, owner, name] = m;

  // Check opensrcer graph cache
  const cacheDir = join(homedir(), ".opensrcer", "graph-cache", `${owner}__${name}`, "graphify-out", "graph.json");
  if (existsSync(cacheDir)) return cacheDir;

  // Check contribai repo cache
  const contribDir = join(homedir(), ".contribai", "repos", `${owner}__${name}`, "graphify-out", "graph.json");
  if (existsSync(contribDir)) return contribDir;

  return null;
}

async function loadGraph(repo: string): Promise<GraphData> {
  const path = findGraphJson(repo);
  if (!path) throw new Error("Graph not found. Build it first via the Graph page in the opensrcer UI.");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as GraphData;
}

function findNode(graph: GraphData, query: string): GraphNode | null {
  const q = query.toLowerCase().trim();
  return (
    graph.nodes.find(n => n.id === q) ??
    graph.nodes.find(n => n.label.toLowerCase() === q) ??
    graph.nodes.find(n => n.label.toLowerCase().includes(q)) ??
    null
  );
}

export async function traceFlowTool(repo: string, symbol: string): Promise<string> {
  const graph = await loadGraph(repo);
  const startNode = findNode(graph, symbol);
  if (!startNode) return `No node found matching "${symbol}".`;

  const outgoing = new Map<string, GraphEdge[]>();
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) { nodeMap.set(n.id, n); outgoing.set(n.id, []); }
  for (const e of graph.links) outgoing.get(e.source)?.push(e);

  const visited = new Set<string>();
  const lines: string[] = [];

  function walk(id: string, depth: number) {
    if (visited.has(id) || depth > 6) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    const indent = "  ".repeat(depth);
    const loc = node.source_file ? ` (${node.source_file}${node.source_location ? `:${node.source_location}` : ""})` : "";
    lines.push(`${indent}${depth === 0 ? "* " : "-> "}${node.label}${loc}`);
    const edges = (outgoing.get(id) ?? []).filter(e => CALL_RELATIONS.has(e.relation));
    for (const edge of edges.slice(0, 15)) {
      if (!visited.has(edge.target)) {
        lines.push(`${indent}  [${edge.relation}]`);
        walk(edge.target, depth + 1);
      }
    }
  }

  walk(startNode.id, 0);
  return lines.length <= 1
    ? `TRACE: ${startNode.label}\n${lines[0] ?? ""}\n\nNo outgoing call/import edges found.`
    : `EXECUTION FLOW from ${startNode.label}\n${"─".repeat(40)}\n${lines.join("\n")}`;
}

export async function impactAnalysisTool(repo: string, symbol: string): Promise<string> {
  const graph = await loadGraph(repo);
  const targetNode = findNode(graph, symbol);
  if (!targetNode) return `No node found matching "${symbol}".`;

  const incoming = new Map<string, GraphEdge[]>();
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) { nodeMap.set(n.id, n); incoming.set(n.id, []); }
  for (const e of graph.links) incoming.get(e.target)?.push(e);

  const visited = new Set<string>([targetNode.id]);
  const queue: { id: string; depth: number }[] = [{ id: targetNode.id, depth: 0 }];
  const directCallers: { label: string; relation: string; file: string }[] = [];
  const indirectCount = { value: 0 };

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const inEdges = (incoming.get(id) ?? []).filter(e => CALL_RELATIONS.has(e.relation));
    for (const edge of inEdges) {
      if (visited.has(edge.source)) continue;
      visited.add(edge.source);
      const caller = nodeMap.get(edge.source);
      if (!caller) continue;
      if (depth === 0) directCallers.push({ label: caller.label, relation: edge.relation, file: caller.source_file });
      else indirectCount.value++;
      if (depth < 4) queue.push({ id: edge.source, depth: depth + 1 });
    }
  }

  const risk = directCallers.length > 5 ? "HIGH" : directCallers.length > 2 ? "MEDIUM" : "LOW";
  const lines = [
    `IMPACT ANALYSIS: ${targetNode.label}`,
    `Source: ${targetNode.source_file}`,
    `Direct callers: ${directCallers.length}`,
  ];
  for (const c of directCallers) lines.push(`  ${c.label} — ${c.relation} (${c.file})`);
  lines.push(`Indirect dependents: ${indirectCount.value}`, `Blast radius: ${visited.size - 1} nodes`, `Risk: ${risk}`);
  return lines.join("\n");
}

export async function explainAreaTool(repo: string, directory: string): Promise<string> {
  const graph = await loadGraph(repo);
  const dir = directory.replace(/^\/+|\/+$/g, "").toLowerCase();
  const areaNodes = graph.nodes.filter(n => (n.source_file || "").toLowerCase().includes(dir));
  if (areaNodes.length === 0) return `No nodes found for area "${directory}".`;

  const nodeIds = new Set(areaNodes.map(n => n.id));
  const communities = new Map<number, number>();
  for (const n of areaNodes) communities.set(n.community, (communities.get(n.community) ?? 0) + 1);

  const degrees = new Map<string, number>();
  let internal = 0, boundary = 0;
  for (const e of graph.links) {
    const si = nodeIds.has(e.source), ti = nodeIds.has(e.target);
    if (si) degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1);
    if (ti) degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
    if (si && ti) internal++;
    else if (si || ti) boundary++;
  }

  const topNodes = [...degrees.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines = [
    `AREA: ${directory}`,
    `${areaNodes.length} nodes | ${internal} internal edges | ${boundary} boundary edges`,
    `${communities.size} cluster(s)`,
    "",
    "KEY NODES:",
  ];
  for (const [id, deg] of topNodes) {
    const n = graph.nodes.find(n => n.id === id);
    lines.push(`  ${n?.label ?? id} — ${deg} connections`);
  }
  return lines.join("\n");
}
