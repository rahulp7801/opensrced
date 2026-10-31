// s7 Three starting points: the contributor picks at least three files or
// functions. Graded without a model, by graph distance to what the hidden fix
// touches (touchedNodeIds from lib/graph-impact.ts):
//   on target     the pick is in the fix (a changed file or symbol)
//   close         within 2 hops of a node the fix touches
//   red herring   anything else
// Pass = at least one on target, or at least two close. Only graded with a
// verified answer key (lib/lesson/machine.ts isGraded).

import { findNode, hopDistances, type GraphData } from "../../graph";
import { touchedNodeIds } from "../../graph-impact";
import { hiddenDiffFacts } from "../leak";
import { StepInputError, type StepDef } from "./shared";

export type PickVerdict = "on_target" | "close" | "red_herring";
export type PickResult = { pick: string; verdict: PickVerdict; hops: number | null };

export const CLOSE_HOPS = 2;
export const S7_MIN_PICKS = 3;

const norm = (s: string) => s.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\(\)$/, "").replace(/^`|`$/g, "").toLowerCase();
const looksLikeFile = (pick: string) => pick.includes("/") || /\.[a-z0-9]{1,6}$/i.test(pick);
const sameFile = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/** The graph nodes a pick names: every node in a picked file, or the node a
 *  symbol resolves to (lib/graph.ts findNode). */
export function pickNodes(graph: GraphData, pick: string): string[] {
  if (looksLikeFile(pick)) {
    return graph.nodes.filter((n) => n.source_file && sameFile(norm(n.source_file), pick)).map((n) => n.id);
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
  const distances = graph ? hopDistances(graph, touchedNodeIds(graph, diff), CLOSE_HOPS) : new Map<string, number>();
  return picks.map((raw) => {
    const pick = norm(raw);
    if (files.some((f) => sameFile(f, pick)) || symbols.has(pick.split(/[.:#]/).at(-1) ?? pick)) return { pick: raw, verdict: "on_target", hops: 0 };
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
    const lines = (Array.isArray(raw) ? raw : raw.split(/\r?\n|,/)).map((p) => (typeof p === "string" ? p.replace(/^[-*\d.)\s]+/, "").trim() : "")).filter(Boolean);
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
