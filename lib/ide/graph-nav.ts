// Go-to-definition and find-references from the stored code graph, for
// languages the browser has no language server for (§8.5). Pure, so the API
// route (app/api/ide/graph) stays a thin wrapper and the lookup is testable.
//
// Exact symbol matches only: lib/graph.ts findNode falls back to substring
// matches, which is right for a typed question but wrong for jumping to a
// definition (`get` would land on `get_json`).

import type { GraphData, GraphNode } from "../graph";

export interface GraphLocation { file: string; line: number }
export interface GraphNav { definitions: GraphLocation[]; references: GraphLocation[] }

/** Cap per list: a symbol like `get` can have thousands of callers. */
export const GRAPH_NAV_LIMIT = 100;

/** graphify labels functions "name()" and methods ".name()"; files end in an extension. */
function symbolName(node: GraphNode): string {
  return node.label.replace(/^\./, "").replace(/\(\)$/, "");
}

/** "L136" → 136. Anything else points at the top of the file. */
export function graphLine(location: string | undefined): number {
  const match = /^L(\d+)/.exec(location ?? "");
  return match ? Math.max(1, Number(match[1])) : 1;
}

// Structure (a file contains a function, a class has a method) and docstring
// links, not places the symbol is used.
const NOT_A_USE = new Set(["contains", "method", "rationale_for"]);

export function graphNav(graph: GraphData, symbol: string): GraphNav {
  const wanted = symbol.trim();
  if (!wanted) return { definitions: [], references: [] };
  const defs = graph.nodes.filter((node) => node.source_file && symbolName(node) === wanted);
  const ids = new Set(defs.map((node) => node.id));
  const seen = new Set<string>();
  const unique = (loc: GraphLocation) => {
    const key = `${loc.file}:${loc.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const definitions = defs
    .map((node) => ({ file: node.source_file, line: graphLine(node.source_location) }))
    .filter(unique)
    .slice(0, GRAPH_NAV_LIMIT);
  const references = graph.links
    .filter((edge) => ids.has(edge.target) && edge.source_file && !NOT_A_USE.has(edge.relation))
    .map((edge) => ({ file: edge.source_file, line: graphLine(edge.source_location) }))
    .filter(unique)
    .slice(0, GRAPH_NAV_LIMIT);
  return { definitions, references };
}
