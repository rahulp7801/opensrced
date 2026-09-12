import type { GraphData } from "./graph";

export type ImpactResult = {
  totalAffected: number;
  affectedModules: number;
  affectedLabels: string[];
  topNode: string;
};

const CALL_RELATIONS = new Set([
  "calls", "imports", "imports_from", "instantiates", "references", "uses_component",
]);

export function analyzeImpactFromDiff(graph: GraphData, diff: string): ImpactResult {
  const changedFiles = [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
    .map((match) => match[1].toLowerCase().replace(/\\/g, "/"));
  const changedSymbols = new Set<string>();
  const definition = /^[+-]\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/;
  for (const line of diff.split("\n")) {
    const match = definition.exec(line);
    if (match) changedSymbols.add(match[1].toLowerCase());
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const matchedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const sourceFile = (node.source_file || "").toLowerCase().replace(/\\/g, "/");
    const label = node.label.toLowerCase().replace(/\(\)$/, "");
    if ((sourceFile && changedFiles.some((file) => sourceFile.includes(file) || file.includes(sourceFile))) || changedSymbols.has(label)) {
      matchedNodeIds.add(node.id);
    }
  }
  if (matchedNodeIds.size === 0) {
    return { totalAffected: 0, affectedModules: 0, affectedLabels: [], topNode: "" };
  }

  const incoming = new Map<string, string[]>();
  for (const link of graph.links) {
    if (!CALL_RELATIONS.has(link.relation)) continue;
    const sources = incoming.get(link.target) ?? [];
    sources.push(link.source);
    incoming.set(link.target, sources);
  }

  const visited = new Set(matchedNodeIds);
  const queue = [...matchedNodeIds];
  const affectedCommunities = new Set<number>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const node = nodesById.get(current);
    if (node) affectedCommunities.add(node.community);
    for (const source of incoming.get(current) ?? []) {
      if (visited.has(source)) continue;
      visited.add(source);
      queue.push(source);
    }
  }

  const dependentIds = [...visited].filter((id) => !matchedNodeIds.has(id));
  let topNode = "";
  let topDegree = 0;
  for (const id of matchedNodeIds) {
    const degree = (incoming.get(id) ?? []).length;
    if (degree > topDegree) {
      topDegree = degree;
      topNode = nodesById.get(id)?.label ?? id;
    }
  }
  return {
    totalAffected: dependentIds.length,
    affectedModules: affectedCommunities.size,
    affectedLabels: dependentIds.map((id) => nodesById.get(id)?.label ?? id).slice(0, 10),
    topNode,
  };
}
