// Graph traversal and query engine for graphify knowledge graphs.
// All operations are pure JS over the parsed graph.json — zero LLM cost.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types (matching graphify's graph.json schema) ─────────────────────

export interface GraphNode {
  id: string;
  label: string;
  community: number;
  file_type: string;
  source_file: string;
  source_location?: string;
  norm_label?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
  source_file: string;
  source_location?: string;
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
  hyperedges?: unknown[];
}

// ── Cache paths ───────────────────────────────────────────────────────

export function graphCacheDir(owner: string, repo: string): string {
  return join(homedir(), ".opensrcer", "graph-cache", `${owner}__${repo}`);
}

export function graphJsonPath(owner: string, repo: string): string {
  return join(graphCacheDir(owner, repo), "graphify-out", "graph.json");
}

export function graphHtmlPath(owner: string, repo: string): string {
  return join(graphCacheDir(owner, repo), "graphify-out", "graph.html");
}

export async function loadGraph(owner: string, repo: string): Promise<GraphData> {
  const raw = await readFile(graphJsonPath(owner, repo), "utf8");
  return JSON.parse(raw) as GraphData;
}

// ── Module naming ─────────────────────────────────────────────────────
// Graphify calls groups "communities" (from Leiden clustering). We derive
// human-readable names from the most common directory path in each group
// so users see "lib/application" instead of "Cluster 9".

export function moduleName(nodes: GraphNode[]): string {
  if (nodes.length === 0) return "unknown";
  // Count directory prefixes
  const dirs = new Map<string, number>();
  for (const n of nodes) {
    const sf = (n.source_file || "").replace(/\\/g, "/");
    // Use directory + filename stem as the label
    const parts = sf.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : parts[0];
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  // Pick the most common directory
  const topDir = [...dirs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  // If all nodes share a common file, use the file label instead
  if (nodes.length <= 3) {
    return nodes.map((n) => n.label).join(", ");
  }
  return topDir || nodes[0].label;
}

export function buildModuleMap(graph: GraphData): Map<number, string> {
  const groups = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const list = groups.get(n.community) ?? [];
    list.push(n);
    groups.set(n.community, list);
  }
  const names = new Map<number, string>();
  for (const [cid, nodes] of groups) {
    names.set(cid, moduleName(nodes));
  }
  return names;
}

// ── Adjacency helpers ─────────────────────────────────────────────────

interface AdjacencyMap {
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  nodeMap: Map<string, GraphNode>;
}

function buildAdjacency(graph: GraphData): AdjacencyMap {
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const nodeMap = new Map<string, GraphNode>();

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of graph.links) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  return { outgoing, incoming, nodeMap };
}

function findNode(graph: GraphData, query: string): GraphNode | null {
  const q = query.toLowerCase().trim();
  return (
    graph.nodes.find((n) => n.id === q) ??
    graph.nodes.find((n) => n.label.toLowerCase() === q) ??
    graph.nodes.find((n) => n.label.toLowerCase().includes(q)) ??
    graph.nodes.find((n) => n.norm_label?.includes(q)) ??
    null
  );
}

// ── Query functions ───────────────────────────────────────────────────

const CALL_RELATIONS = new Set([
  "calls",
  "imports",
  "imports_from",
  "instantiates",
  "references",
  "uses_component",
  "binds_method",
]);

export function traceFlow(graph: GraphData, symbol: string): string {
  const startNode = findNode(graph, symbol);
  if (!startNode)
    return `No node found matching "${symbol}". Try a different name or run "stats" to see what's in the graph.`;

  const adj = buildAdjacency(graph);
  const visited = new Set<string>();
  const lines: string[] = [];

  function walk(nodeId: string, depth: number) {
    if (visited.has(nodeId) || depth > 6) return;
    visited.add(nodeId);

    const node = adj.nodeMap.get(nodeId);
    if (!node) return;

    const indent = "  ".repeat(depth);
    const loc = node.source_file
      ? ` (${node.source_file}${node.source_location ? `:${node.source_location}` : ""})`
      : "";
    lines.push(`${indent}${depth === 0 ? "* " : "-> "}${node.label}${loc}`);

    const edges = (adj.outgoing.get(nodeId) ?? []).filter((e) =>
      CALL_RELATIONS.has(e.relation),
    );
    for (const edge of edges.slice(0, 15)) {
      if (!visited.has(edge.target)) {
        lines.push(`${indent}  [${edge.relation}]`);
        walk(edge.target, depth + 1);
      }
    }
  }

  walk(startNode.id, 0);

  if (lines.length === 1) {
    return `TRACE: ${startNode.label}\n${lines[0]}\n\nNo outgoing call/import edges found from this node.`;
  }

  return `EXECUTION FLOW from ${startNode.label}\n${"─".repeat(40)}\n${lines.join("\n")}`;
}

export function impactAnalysis(graph: GraphData, symbol: string): string {
  const targetNode = findNode(graph, symbol);
  if (!targetNode) return `No node found matching "${symbol}".`;

  const adj = buildAdjacency(graph);
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [
    { id: targetNode.id, depth: 0 },
  ];
  visited.add(targetNode.id);

  const directCallers: { node: GraphNode; relation: string }[] = [];
  const indirectCallers: { node: GraphNode; depth: number }[] = [];
  const affectedCommunities = new Set<number>();
  affectedCommunities.add(targetNode.community);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const inEdges = (adj.incoming.get(id) ?? []).filter((e) =>
      CALL_RELATIONS.has(e.relation),
    );

    for (const edge of inEdges) {
      if (visited.has(edge.source)) continue;
      visited.add(edge.source);

      const callerNode = adj.nodeMap.get(edge.source);
      if (!callerNode) continue;
      affectedCommunities.add(callerNode.community);

      if (depth === 0) {
        directCallers.push({ node: callerNode, relation: edge.relation });
      } else {
        indirectCallers.push({ node: callerNode, depth: depth + 1 });
      }

      if (depth < 4) queue.push({ id: edge.source, depth: depth + 1 });
    }
  }

  const moduleNames = buildModuleMap(graph);
  const totalModules = moduleNames.size;
  const risk =
    directCallers.length > 5
      ? "HIGH"
      : directCallers.length > 2
        ? "MEDIUM"
        : "LOW";

  const lines: string[] = [
    `IMPACT ANALYSIS: ${targetNode.label}`,
    "─".repeat(40),
    `Source: ${targetNode.source_file}${targetNode.source_location ? `:${targetNode.source_location}` : ""}`,
    `Module: ${moduleNames.get(targetNode.community) ?? "unknown"}`,
    "",
  ];

  if (directCallers.length > 0) {
    lines.push(`DIRECT CALLERS (${directCallers.length}):`);
    for (const { node, relation } of directCallers)
      lines.push(`  ${node.label} — ${relation} (${node.source_file})`);
    lines.push("");
  } else {
    lines.push("DIRECT CALLERS: None found\n");
  }

  if (indirectCallers.length > 0) {
    lines.push(`INDIRECT DEPENDENTS (${indirectCallers.length}):`);
    for (const { node, depth } of indirectCallers.slice(0, 20))
      lines.push(
        `  ${"  ".repeat(depth - 1)}${node.label} (depth ${depth}, ${node.source_file})`,
      );
    lines.push("");
  }

  const affectedModuleNames = [...affectedCommunities]
    .map((c) => moduleNames.get(c) ?? `module-${c}`)
    .slice(0, 5);
  lines.push(
    `AFFECTED MODULES: ${affectedCommunities.size} of ${totalModules} (${affectedModuleNames.join(", ")})`,
    `BLAST RADIUS: ${visited.size - 1} nodes affected`,
    `RISK: ${risk}`,
  );

  return lines.join("\n");
}

export function explainArea(graph: GraphData, directory: string): string {
  const dir = directory.replace(/^\/+|\/+$/g, "").toLowerCase();

  const areaNodes = graph.nodes.filter((n) =>
    (n.source_file || "").toLowerCase().includes(dir),
  );

  if (areaNodes.length === 0) {
    const labelNodes = graph.nodes.filter((n) =>
      n.label.toLowerCase().includes(dir),
    );
    if (labelNodes.length === 0)
      return `No nodes found for area "${directory}". Try a different path or run "stats".`;
    return formatNodeSet(graph, labelNodes, directory);
  }

  return formatNodeSet(graph, areaNodes, directory);
}

function formatNodeSet(
  graph: GraphData,
  nodes: GraphNode[],
  area: string,
): string {
  const communities = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const list = communities.get(n.community) ?? [];
    list.push(n);
    communities.set(n.community, list);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const degreeCounts = new Map<string, number>();
  let internalEdges = 0;
  let externalEdges = 0;
  const relations = new Map<string, number>();

  for (const edge of graph.links) {
    const srcIn = nodeIds.has(edge.source);
    const tgtIn = nodeIds.has(edge.target);
    if (srcIn)
      degreeCounts.set(edge.source, (degreeCounts.get(edge.source) ?? 0) + 1);
    if (tgtIn)
      degreeCounts.set(edge.target, (degreeCounts.get(edge.target) ?? 0) + 1);
    if (srcIn && tgtIn) internalEdges++;
    else if (srcIn || tgtIn) externalEdges++;
    if (srcIn || tgtIn)
      relations.set(edge.relation, (relations.get(edge.relation) ?? 0) + 1);
  }

  const topNodes = [...degreeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, deg]) => {
      const node = graph.nodes.find((n) => n.id === id);
      return {
        label: node?.label ?? id,
        degree: deg,
        file: node?.source_file ?? "",
      };
    });

  const fileTypes = new Map<string, number>();
  for (const n of nodes) {
    const ft = n.file_type || "unknown";
    fileTypes.set(ft, (fileTypes.get(ft) ?? 0) + 1);
  }

  const lines: string[] = [
    `AREA: ${area}`,
    "─".repeat(40),
    `${nodes.length} nodes | ${internalEdges} internal edges | ${externalEdges} boundary edges`,
    `${communities.size} module(s) | ${[...fileTypes.entries()].map(([k, v]) => `${v} ${k}`).join(", ")}`,
    "",
  ];

  if (topNodes.length > 0) {
    lines.push("KEY NODES (by connectivity):");
    for (const g of topNodes)
      lines.push(`  ${g.label} — ${g.degree} connections (${g.file})`);
    lines.push("");
  }

  lines.push("MODULES:");
  for (const [, cnodes] of [...communities.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const name = moduleName(cnodes);
    const labels = cnodes
      .slice(0, 8)
      .map((n) => n.label)
      .join(", ");
    const more = cnodes.length > 8 ? ` +${cnodes.length - 8} more` : "";
    lines.push(`  ${name} (${cnodes.length} nodes): ${labels}${more}`);
  }
  lines.push("");

  if (relations.size > 0) {
    lines.push("RELATIONSHIP TYPES:");
    for (const [rel, count] of [...relations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8))
      lines.push(`  ${rel}: ${count}`);
  }

  return lines.join("\n");
}

export function shortestPath(
  graph: GraphData,
  source: string,
  target: string,
): string {
  const srcNode = findNode(graph, source);
  const tgtNode = findNode(graph, target);
  if (!srcNode) return `Source node "${source}" not found.`;
  if (!tgtNode) return `Target node "${target}" not found.`;
  if (srcNode.id === tgtNode.id)
    return `Source and target are the same node: ${srcNode.label}`;

  const adj = buildAdjacency(graph);
  const visited = new Map<
    string,
    { parent: string; edge: GraphEdge } | null
  >();
  visited.set(srcNode.id, null);
  const queue = [srcNode.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === tgtNode.id) break;

    const outEdges = adj.outgoing.get(current) ?? [];
    const inEdges = adj.incoming.get(current) ?? [];
    const allNeighbors = [
      ...outEdges.map((e) => ({ id: e.target, edge: e })),
      ...inEdges.map((e) => ({ id: e.source, edge: e })),
    ];

    for (const { id, edge } of allNeighbors) {
      if (!visited.has(id)) {
        visited.set(id, { parent: current, edge });
        queue.push(id);
      }
    }
  }

  if (!visited.has(tgtNode.id))
    return `No path found between "${srcNode.label}" and "${tgtNode.label}".`;

  const path: { node: GraphNode; edge?: GraphEdge }[] = [];
  let current: string | undefined = tgtNode.id;
  while (current !== undefined) {
    const node = adj.nodeMap.get(current)!;
    const entry = visited.get(current);
    path.unshift({ node, edge: entry?.edge });
    current = entry?.parent;
  }

  const lines: string[] = [
    `PATH: ${srcNode.label} -> ${tgtNode.label} (${path.length - 1} hops)`,
    "─".repeat(40),
  ];

  for (let i = 0; i < path.length; i++) {
    const { node, edge } = path[i];
    const loc = node.source_file ? ` (${node.source_file})` : "";
    if (i === 0) {
      lines.push(`  ${node.label}${loc}`);
    } else {
      lines.push(`    | [${edge?.relation ?? "?"}, ${edge?.confidence ?? "?"}]`);
      lines.push(`  ${node.label}${loc}`);
    }
  }

  return lines.join("\n");
}

export function godNodes(graph: GraphData, topN = 10): string {
  const degrees = new Map<string, number>();
  for (const edge of graph.links) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }

  const sorted = [...degrees.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const moduleNames = buildModuleMap(graph);

  const lines: string[] = [
    `KEY NODES (top ${topN} by connectivity)`,
    "─".repeat(40),
  ];

  for (const [id, deg] of sorted) {
    const node = graph.nodes.find((n) => n.id === id);
    const mod = moduleNames.get(node?.community ?? -1) ?? "";
    lines.push(
      `  ${String(deg).padStart(4)} edges  ${node?.label ?? id}  (${mod}, ${node?.source_file ?? ""})`,
    );
  }

  return lines.join("\n");
}

export function graphStats(graph: GraphData): string {
  const moduleNames = buildModuleMap(graph);
  const conf = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 };
  const rels = new Map<string, number>();

  for (const edge of graph.links) {
    const c = edge.confidence as keyof typeof conf;
    if (c in conf) conf[c]++;
    rels.set(edge.relation, (rels.get(edge.relation) ?? 0) + 1);
  }

  const fileTypes = new Map<string, number>();
  for (const node of graph.nodes) {
    const ft = node.file_type || "unknown";
    fileTypes.set(ft, (fileTypes.get(ft) ?? 0) + 1);
  }

  const total = graph.links.length || 1;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  // Top modules by size
  const modSizes = new Map<string, number>();
  for (const [, name] of moduleNames) {
    modSizes.set(name, (modSizes.get(name) ?? 0) + 1);
  }
  const topModules = [...modSizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const lines: string[] = [
    "GRAPH STATISTICS",
    "─".repeat(40),
    `Nodes: ${graph.nodes.length}`,
    `Edges: ${graph.links.length}`,
    `Modules: ${moduleNames.size}`,
    `Hyperedges: ${graph.hyperedges?.length ?? 0}`,
    "",
    "CONFIDENCE:",
    `  EXTRACTED: ${conf.EXTRACTED} (${pct(conf.EXTRACTED)}%)`,
    `  INFERRED:  ${conf.INFERRED} (${pct(conf.INFERRED)}%)`,
    `  AMBIGUOUS: ${conf.AMBIGUOUS} (${pct(conf.AMBIGUOUS)}%)`,
    "",
    "NODE TYPES:",
  ];

  for (const [ft, count] of [...fileTypes.entries()].sort(
    (a, b) => b[1] - a[1],
  ))
    lines.push(`  ${ft}: ${count}`);

  lines.push("", "TOP MODULES:");
  for (const [name, count] of topModules)
    lines.push(`  ${name}: ${count} nodes`);

  lines.push("", "TOP RELATIONS:");
  for (const [rel, count] of [...rels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10))
    lines.push(`  ${rel}: ${count}`);

  return lines.join("\n");
}

// ── Node info ─────────────────────────────────────────────────────────

function nodeInfo(graph: GraphData, query: string): string {
  const node = findNode(graph, query);
  if (!node) return "";

  const adj = buildAdjacency(graph);
  const moduleNames = buildModuleMap(graph);
  const outEdges = adj.outgoing.get(node.id) ?? [];
  const inEdges = adj.incoming.get(node.id) ?? [];

  const lines: string[] = [
    `NODE: ${node.label}`,
    "─".repeat(40),
    `ID: ${node.id}`,
    `Type: ${node.file_type}`,
    `Source: ${node.source_file}${node.source_location ? `:${node.source_location}` : ""}`,
    `Module: ${moduleNames.get(node.community) ?? "unknown"}`,
    `Connections: ${outEdges.length} outgoing, ${inEdges.length} incoming`,
  ];

  if (outEdges.length > 0) {
    lines.push("", "OUTGOING:");
    for (const e of outEdges.slice(0, 10)) {
      const target = adj.nodeMap.get(e.target);
      lines.push(`  -> ${target?.label ?? e.target} [${e.relation}]`);
    }
    if (outEdges.length > 10)
      lines.push(`  ... and ${outEdges.length - 10} more`);
  }

  if (inEdges.length > 0) {
    lines.push("", "INCOMING:");
    for (const e of inEdges.slice(0, 10)) {
      const source = adj.nodeMap.get(e.source);
      lines.push(`  <- ${source?.label ?? e.source} [${e.relation}]`);
    }
    if (inEdges.length > 10)
      lines.push(`  ... and ${inEdges.length - 10} more`);
  }

  return lines.join("\n");
}

// ── Graph summary for LLM context ─────────────────────────────────────

export function buildGraphSummary(graph: GraphData): string {
  const moduleNames = buildModuleMap(graph);
  const degrees = new Map<string, number>();
  for (const e of graph.links) {
    degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
  }
  const topNodes = [...degrees.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, deg]) => {
      const n = graph.nodes.find((x) => x.id === id);
      return `${n?.label ?? id} (${deg} edges, ${n?.source_file ?? "?"})`;
    });

  const modGroups = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const list = modGroups.get(n.community) ?? [];
    list.push(n);
    modGroups.set(n.community, list);
  }
  const topModules = [...modGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([cid, nodes]) => {
      const name = moduleNames.get(cid) ?? `module-${cid}`;
      const members = nodes.slice(0, 5).map((n) => n.label).join(", ");
      return `${name} (${nodes.length} nodes): ${members}`;
    });

  const edges = graph.links.slice(0, 30).map(
    (e) => `${e.source} --[${e.relation}]--> ${e.target}`,
  );

  return [
    `Codebase graph: ${graph.nodes.length} nodes, ${graph.links.length} edges`,
    "",
    "Key nodes: " + topNodes.join("; "),
    "",
    "Modules: " + topModules.join(" | "),
    "",
    "Sample edges:\n" + edges.join("\n"),
  ].join("\n");
}

export const FALLBACK_SENTINEL = "Could not match your query.";

// ── Query router ──────────────────────────────────────────────────────

export function routeQuery(graph: GraphData, query: string): string {
  const q = query.trim();
  const ql = q.toLowerCase();

  // Help command
  if (ql === "help" || ql === "-help" || ql === "--help" || ql === "?") {
    return helpText();
  }

  // Command-style
  if (ql.startsWith("trace ")) return traceFlow(graph, q.slice(6).trim());
  if (ql.startsWith("impact ")) return impactAnalysis(graph, q.slice(7).trim());
  if (ql.startsWith("explain ")) return explainArea(graph, q.slice(8).trim());
  if (ql.startsWith("path ")) {
    const rest = q.slice(5).trim();
    const parts = rest.split(/\s+(?:to|→|->)\s+/i);
    if (parts.length >= 2)
      return shortestPath(graph, parts[0], parts.slice(1).join(" "));
    return 'Usage: path <source> to <target>';
  }
  if (ql === "stats" || ql === "statistics" || ql === "overview")
    return graphStats(graph);
  if (ql.startsWith("god") || ql.startsWith("top nodes") || ql.startsWith("key nodes")) {
    const n = parseInt(ql.replace(/\D/g, "")) || 10;
    return godNodes(graph, n);
  }

  // Natural language intent detection
  if (ql.includes("what calls") || ql.includes("who calls") || ql.includes("what uses")) {
    const sym = ql.replace(/what calls|who calls|what uses/g, "").replace(/[?"]/g, "").trim();
    if (sym) return impactAnalysis(graph, sym);
  }
  if (ql.includes("what does") && ql.includes("call")) {
    const sym = ql.replace(/what does|call\??.*/g, "").replace(/[?"]/g, "").trim();
    if (sym) return traceFlow(graph, sym);
  }
  if (ql.includes("how does") && (ql.includes("connect") || ql.includes("relate") || ql.includes("reach"))) {
    const m = ql.match(/how does (.+?) (?:connect|relate|reach) (?:to )?(.+?)(?:\?|$)/);
    if (m) return shortestPath(graph, m[1].trim(), m[2].trim());
  }
  if (ql.includes("impact") || ql.includes("blast radius") || ql.includes("what breaks") || ql.includes("affect")) {
    const sym = ql.replace(/impact|blast radius|what breaks|if i change|what would|affect|changing/g, "").replace(/[?"]/g, "").trim();
    if (sym) return impactAnalysis(graph, sym);
  }
  if (ql.includes("trace") || ql.includes("flow") || ql.includes("execution")) {
    const sym = ql.replace(/trace|flow|execution|the|of|through/g, "").replace(/[?"]/g, "").trim();
    if (sym) return traceFlow(graph, sym);
  }
  if (ql.includes("explain") || ql.includes("describe")) {
    const sym = ql.replace(/explain|describe|the|module|area|directory/g, "").replace(/[?"]/g, "").trim();
    if (sym) return explainArea(graph, sym);
  }

  // Fallback: try to match a node
  const info = nodeInfo(graph, q.replace(/[?"]/g, ""));
  if (info) return info;

  return `${FALLBACK_SENTINEL} Type "help" for available commands, or ask a plain English question (uses AI).`;
}

function helpText(): string {
  return `GRAPH QUERY COMMANDS
${"─".repeat(40)}
All commands below are free — zero LLM cost.

TRACE — follow what a function calls
  trace <name>              trace execution flow from a symbol
  Example: trace handlePayment
  Shows the call chain: what it calls, what those call, etc.

IMPACT — see what breaks if you change something
  impact <name>             blast radius analysis
  Example: impact UserService
  Shows direct callers, indirect dependents, affected modules, risk level.

EXPLAIN — understand an area of the codebase
  explain <path>            module/directory overview
  Example: explain src/api
  Shows key nodes, modules, internal vs external connections.

PATH — find how two things connect
  path <A> to <B>           shortest path between two nodes
  Example: path auth to billing
  Shows each hop with the relationship type.

STATS — graph overview
  stats                     node/edge counts, modules, confidence breakdown

KEY NODES — most connected components
  god nodes                 top 10 most connected nodes in the codebase

NODE LOOKUP — type any symbol or filename
  <name>                    shows a node's connections and metadata
  Example: utils.js

PLAIN ENGLISH — ask anything (uses AI, ~$0.001)
  Any question that doesn't match a command above is answered by AI
  using the graph as context. No codebase access — just the graph data.
  Example: "what is the main entry point of this app?"
  Example: "how is error handling structured?"`;
}
