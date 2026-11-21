// s7 Three starting points: the contributor picks at least three files or
// functions. Graded without a model, by graph distance to the code the hidden fix
// edits (editedNodeIds from lib/graph-impact.ts: the functions its changed lines sit in):
//   on target     the pick is in the fix (a changed file or symbol)
//   close         within 2 hops of a node the fix touches
//   red herring   anything else
// Pass = at least one on target, or at least two close. Only graded with a
// verified answer key (lib/lesson/machine.ts isGraded).

import { findNode, hopDistances, type GraphData } from "../../graph";
import { editedNodeIds } from "../../graph-impact";
import { hiddenDiffFacts } from "../leak";
import { StepInputError, type StepDef } from "./shared";

export type PickVerdict = "on_target" | "close" | "red_herring";
export type PickResult = { pick: string; verdict: PickVerdict; hops: number | null };

export const CLOSE_HOPS = 2;
export const S7_MIN_PICKS = 3;

// A code file: a path ending in a source or docs extension.
const CODE_FILE = /(?:[\w.-]+\/)*[\w-][\w.-]*\.(?:py|pyi|js|mjs|cjs|jsx|ts|tsx|go|rs|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala|sh|md|rst|toml|ya?ml|json|cfg|ini|txt|html|css)\b/gi;
// A qualified name like Serializer.loads or (Rust, C++, PHP, Ruby) Error::fix_position, or a call like loads().
const DOTTED = /\b[A-Za-z_]\w*(?:(?:\.|::)[A-Za-z_]\w*)+(?:\(\))?|\b[A-Za-z_]\w*\(\)/g;

/** The picks in one line of the answer. The student's own words reach here
 *  as they wrote them ("My starting points: serializer.py (Serializer.loads)
 *  and timed.py to see ..."), so a line naming files or qualified names gives
 *  those; a bare word is taken as it is (a function name); words with no name
 *  in them ("which makes the error") are prose, not a pick. Pure; exported for tests. */
export function picksIn(line: string): string[] {
  const text = line.replace(/^and\s+/i, "").trim();
  if (!text) return [];
  const files = text.match(CODE_FILE) ?? [];
  const rest = files.reduce((t, f) => t.replace(f, " "), text);
  const names = (rest.match(DOTTED) ?? []).filter((n) => !/^(?:e\.g|i\.e|etc)\b/i.test(n));
  if (files.length || names.length) return [...files, ...names];
  return /\s/.test(text) ? [] : [text];
}

const norm = (s: string) => s.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\(\)$/, "").replace(/^`|`$/g, "").toLowerCase();
// A path, or a name with a real file extension: "Serializer.loads" is a method, not a ".loads" file.
const looksLikeFile = (pick: string) => pick.includes("/") || new RegExp(`^${CODE_FILE.source}$`, "i").test(pick);
const sameFile = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
// A folder names the files in it (date-fns keeps each function in its own folder) as long as it's
// specific: "src/" or a whole package isn't finding where to look.
export const FOLDER_PICK_MAX_FILES = 25;
const inFolder = (file: string, folder: string) => {
  const f = folder.replace(/\/+$/, "");
  return file.startsWith(`${f}/`) || file.includes(`/${f}/`);
};
/** The files of the graph a folder pick names, or [] when it names none or too many. */
function folderFiles(graph: GraphData, pick: string): string[] {
  const files = [...new Set(graph.nodes.map((n) => norm(n.source_file || "")).filter((f) => f && inFolder(f, pick)))];
  return files.length <= FOLDER_PICK_MAX_FILES ? files : [];
}

/** The graph nodes a pick names: every node in a picked file (or a specific folder's files),
 *  or the node a symbol resolves to (lib/graph.ts findNode). */
export function pickNodes(graph: GraphData, pick: string): string[] {
  if (looksLikeFile(pick)) {
    const exact = graph.nodes.filter((n) => n.source_file && sameFile(norm(n.source_file), pick)).map((n) => n.id);
    if (exact.length) return exact;
    const inside = new Set(folderFiles(graph, pick));
    return graph.nodes.filter((n) => inside.has(norm(n.source_file || ""))).map((n) => n.id);
  }
  // "Serializer.loads": graphify labels methods ".loads()" (no class), but its
  // ids end in the qualified name (…_serializer_serializer_loads), so match those.
  // A Rust impl's generics sit between the two (UnitVariantAccess<'a, R>::tuple_variant
  // is …_unitvariantaccess_a_r_tuple_variant): matched when nothing is exact.
  const parts = pick.replace(/\(\)$/, "").split(/\.|::/).filter(Boolean);
  if (parts.length >= 2) {
    const ids = graph.nodes.map((n) => [n.id, n.id.toLowerCase()] as const);
    const suffix = `_${parts.join("_")}`.toLowerCase();
    const qualified = ids.filter(([, id]) => id.endsWith(suffix)).map(([id]) => id);
    if (qualified.length) return qualified;
    const escape = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const generic = new RegExp(`_${parts.slice(0, -1).map(escape).join("_")}(?:_[a-z0-9]+){1,3}_${escape(parts.at(-1)!)}$`);
    const loose = ids.filter(([, id]) => generic.test(id)).map(([id]) => id);
    if (loose.length) return loose;
  }
  const node = pick.length >= 3 ? findNode(graph, pick) : null;
  return node ? [node.id] : [];
}

/** Each pick's verdict. Works without a graph too: picks that name a
 *  changed file or symbol are still on target; the rest cannot be measured
 *  and count as red herrings. */
export function gradePicks(graph: GraphData | null, diff: string, picks: string[]): PickResult[] {
  const facts = hiddenDiffFacts(diff);
  const files = facts.files.map(norm);
  const symbols = new Set(facts.symbols.map((s) => s.toLowerCase()));
  const distances = graph ? hopDistances(graph, editedNodeIds(graph, diff), CLOSE_HOPS) : new Map<string, number>();
  return picks.map((raw) => {
    const pick = norm(raw);
    const folderHit = graph && looksLikeFile(pick) && folderFiles(graph, pick).some((g) => files.some((f) => sameFile(f, g)));
    if (files.some((f) => sameFile(f, pick)) || folderHit || symbols.has(pick.split(/[.:#]/).at(-1) ?? pick)) return { pick: raw, verdict: "on_target", hops: 0 };
    const hops = graph ? Math.min(...pickNodes(graph, pick).map((id) => distances.get(id) ?? Infinity)) : Infinity;
    if (hops === 0) return { pick: raw, verdict: "on_target", hops: 0 };
    if (hops <= CLOSE_HOPS) return { pick: raw, verdict: "close", hops };
    return { pick: raw, verdict: "red_herring", hops: null };
  });
}

export function picksPass(results: PickResult[]): boolean {
  const onTarget = results.filter((r) => r.verdict === "on_target").length;
  const close = results.filter((r) => r.verdict === "close").length;
  return onTarget >= 1 || close >= 2;
}

const LABEL: Record<PickVerdict, string> = { on_target: "on target", close: "close", red_herring: "a red herring" };

export const s7: StepDef<string[]> = {
  id: "s7",
  title: "Three starting points",
  question: "Name at least three files or functions where you would start looking, one per line.",
  hintQuestion: "Where in the code does the behaviour from the issue happen? What runs right before it?",
  nudge: "Follow the issue's example through the code: the public function it calls first, then what that calls.",
  needs: ["graph", "answerKey"],
  parseAnswer(raw) {
    if (typeof raw !== "string" && !Array.isArray(raw)) throw new StepInputError("List your picks, one per line.");
    const lines = (Array.isArray(raw) ? raw : raw.split(/\r?\n|,|;/)).flatMap((p) => (typeof p === "string" ? picksIn(p.replace(/^[-*\d.)\s]+/, "").trim()) : []));
    const picks = [...new Set(lines)];
    if (picks.length < S7_MIN_PICKS) throw new StepInputError(`Pick at least ${S7_MIN_PICKS} different files or functions.`);
    if (picks.length > 8 || picks.some((p) => p.length > 200)) throw new StepInputError("Keep it to at most 8 picks.");
    return picks;
  },
  grade(ctx, picks) {
    if (!ctx.answerKey) return null;
    const results = gradePicks(ctx.graph, ctx.answerKey.diff, picks);
    const passed = picksPass(results);
    const lines = results.map((r) => `${r.pick}: ${LABEL[r.verdict]}${r.verdict === "close" ? ` (${r.hops} step${r.hops === 1 ? "" : "s"} away)` : ""}`);
    const feedback = `${lines.join("; ")}. ${passed ? "Good: you found your way to the right area." : "Not yet: ask the teacher why the red herrings are off, then try again."}`;
    return { passed, feedback, detail: { results } };
  },
};
