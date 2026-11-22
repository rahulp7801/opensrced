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

/** The graph nodes a diff touches: nodes in a changed file, or whose label is
 *  a symbol the diff defines or changes. */
export function touchedNodeIds(graph: GraphData, diff: string): Set<string> {
  const changedFiles = [...diff.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)]
    .map((match) => match[1].toLowerCase().replace(/\\/g, "/"));
  const changedSymbols = new Set<string>();
  const definition = /^[+-]\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/;
  for (const line of diff.split("\n")) {
    const match = definition.exec(line);
    if (match) changedSymbols.add(match[1].toLowerCase());
  }

  const matchedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const sourceFile = (node.source_file || "").toLowerCase().replace(/\\/g, "/");
    const label = node.label.toLowerCase().replace(/\(\)$/, "");
    if ((sourceFile && changedFiles.some((file) => sourceFile.includes(file) || file.includes(sourceFile))) || changedSymbols.has(label)) {
      matchedNodeIds.add(node.id);
    }
  }
  return matchedNodeIds;
}

/** Each changed file's changed lines, numbered as in the old file (a removed line where it was,
 *  an added one at the line it follows), the names in its hunk headers (git puts the enclosing
 *  function there: "@@ -340,3 +340,4 @@ def save_session(…)"), and whether it adds whole new
 *  functions or types (a test appended after the last one). Pure; exported for tests. */
export function changedOldLines(diff: string): Map<string, { lines: number[]; headers: string[]; adds: boolean }> {
  const out = new Map<string, { lines: number[]; headers: string[]; adds: boolean }>();
  let file = "";
  let old = 0;
  let inHunk = false;
  // Added lines wait for the end of their run: a run of only additions that defines a function
  // or type is a new one, not a change to the one above it (which git names in the hunk header).
  let run: number[] = [];
  let pure = true;
  let defines = false;
  let hunkKept = 0;
  let hunkAdds = false;
  let hunkHeader = false;
  // A change followed only by closing brackets and decorators, then a definition, is in that
  // definition's decorator (new @pytest.mark.parametrize cases), not the function above it.
  let group = -1; // where the latest change starts in `lines`, while it may be one
  const open = () => { if (group < 0) group = out.get(file)!.lines.length; };
  const flush = () => {
    if (file && run.length) {
      if (pure && defines) { hunkAdds = true; out.get(file)!.adds = true; }
      else { out.get(file)!.lines.push(...run); hunkKept += run.length; }
    }
    run = []; pure = true; defines = false;
  };
  // A hunk that only adds new definitions changes nothing its header names.
  const endHunk = () => {
    flush();
    group = -1;
    if (file && hunkHeader && hunkAdds && !hunkKept) out.get(file)!.headers.pop();
    hunkKept = 0; hunkAdds = false; hunkHeader = false;
  };
  const all = diff.split(/\r?\n/);
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    if (line.startsWith("diff --git")) { endHunk(); inHunk = false; continue; }
    // A file's header: "--- a/…" right before "+++ b/…" (even inside a hunk with no "diff --git" between).
    if (line.startsWith("--- ") && all[i + 1]?.startsWith("+++ ")) {
      endHunk();
      file = all[++i].slice(4).trim().replace(/^b\//, "").replace(/\\/g, "/").toLowerCase();
      if (!out.has(file)) out.set(file, { lines: [], headers: [], adds: false });
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@\s*(.*)$/.exec(line);
    if (hunk) {
      endHunk();
      old = Number(hunk[1]);
      inHunk = true;
      const name = /\b(?:def|function|fn|func|class|struct|async\s+def)\s+(\w+)/.exec(hunk[2])?.[1];
      if (file && name) { out.get(file)!.headers.push(name.toLowerCase()); hunkHeader = true; }
      continue;
    }
    if (!inHunk || !file) continue;
    if (line.startsWith("-")) { open(); out.get(file)!.lines.push(old++); hunkKept++; pure = false; }
    else if (line.startsWith("+")) { open(); run.push(Math.max(old - 1, 1)); defines ||= DEFINES.test(line.slice(1)); }
    else {
      flush();
      const lines = out.get(file)!.lines;
      if (group >= 0 && DEFINES.test(line.slice(1))) for (let k = group; k < lines.length; k++) lines[k] = old;
      if (group >= 0 && !CLOSES_OR_DECORATES.test(line.slice(1))) group = -1;
      old++;
    }
  }
  endHunk();
  return out;
}

/** A line that only closes brackets, or a decorator / attribute line (as harness/graph.mjs). */
const CLOSES_OR_DECORATES = /^\s*(?:[)\]}]+[,;]?\s*$|@|#\[)/;

/** A line that starts a function or type (as harness/graph.mjs DEFINES). */
const DEFINES = /^\s*(?:(?:pub(?:\([^)]*\))?|async|export|default|static|unsafe|const|extern(?:\s+"[^"]*")?|public|private|protected)\s+)*(?:def|fn|function|func|class|struct|enum|trait|impl|interface)\b/;

/**
 * The nodes the fix edits, not every node of a changed file (touchedNodeIds): in a project whose
 * core is one big file, that set reaches everything within a hop or two. Per changed file:
 * the function or class each changed line sits in (the last code node starting at or before it);
 * where the graph has no line numbers, the symbols named by its hunk headers or by definitions
 * the fix rewrites; failing those, the file's nodes.
 */
export function editedNodeIds(graph: GraphData, diff: string): Set<string> {
  type Node = GraphData["nodes"][number];
  const lineOf = (node: Node) => Number(/\d+/.exec(node.source_location ?? "")?.[0] ?? NaN);
  const isFileNode = (node: Node) => /\.\w+$/.test(node.label);
  const bare = (node: Node) => node.label.toLowerCase().replace(/^\./, "").replace(/\(\)$/, "");
  const inChanged = (n: Node, file: string) => {
    const source = (n.source_file || "").toLowerCase().replace(/\\/g, "/");
    return Boolean(source) && (source === file || source.endsWith(`/${file}`) || file.endsWith(`/${source}`));
  };
  // A definition the fix removes or rewrites (its old line is "-def …"). A newly added one isn't
  // in the graph yet and would only match namesakes (a new test's local `def cli()`).
  const defined = /^-\s*(?:def|function|fn|func|class|struct|pub\s+fn|async\s+def|const|let|var)\s+(\w+)/;
  const rewritten = diff.split("\n").flatMap((l) => { const m = defined.exec(l); return m ? [m[1].toLowerCase()] : []; });
  const out = new Set<string>();
  for (const [file, { lines, headers, adds }] of changedOldLines(diff)) {
    const inFile = graph.nodes.filter((n) => inChanged(n, file));
    const symbols = inFile.filter((n) => n.file_type === "code" && !isFileNode(n) && Number.isFinite(lineOf(n))).sort((a, b) => lineOf(a) - lineOf(b));
    const enclosing = lines.map((at) => symbols.filter((n) => lineOf(n) <= at).at(-1)).filter((n): n is Node => Boolean(n));
    const names = new Set([...headers, ...rewritten]);
    const named = inFile.filter((n) => names.has(bare(n)));
    // A file the fix only adds new functions to (a test appended) is edited as a file, not in
    // every function already there; else nothing narrower is known: the whole file.
    const fileNodes = !lines.length && !named.length && adds ? inFile.filter(isFileNode) : [];
    for (const n of enclosing.length ? enclosing : named.length ? named : fileNodes.length ? fileNodes : inFile) out.add(n.id);
  }
  return out;
}

export function analyzeImpactFromDiff(graph: GraphData, diff: string): ImpactResult {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const matchedNodeIds = touchedNodeIds(graph, diff);
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
