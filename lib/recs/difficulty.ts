// Difficulty v2 (PLAN.md §6.3): a transparent weighted score, 1–5, with the
// reasons that produced it. Features follow RecGFI (content, background,
// dynamics) plus two of ours: the code graph, and the outcome prior — how big
// the fixes for the most similar solved issues really were, the strongest
// signal. Every number lives in lib/recs/weights.ts DIFFICULTY;
// scripts/calibrate-difficulty.mjs reports how well the score ranks real fix
// sizes (Spearman ρ). A learned model waits for ≥ 2k labelled outcomes.

import { buildModuleMap, dependentsByHop, type GraphData } from "../graph";
import { DIFFICULTY as W } from "./weights";

/** Stored in issues.features at ingest, so difficulty can be recomputed (and
 *  recalibrated) without refetching. Labels are lowercase. */
export type DifficultyFeatures = {
  bodyLength: number;
  codeBlocks: number;
  hasRepro: boolean;
  hasStackTrace: boolean;
  labels: string[];
  reporterIsMaintainer: boolean;
  repoStars: number;
  comments: number;
  participants: number;
  /** Pull requests that referenced the issue and were closed unmerged. */
  attempts: number;
  graph: GraphSignals | null;
};

export type GraphSignals = {
  nodes: number;
  /** The touched node with the most dependents, and how many (up to 3 hops). */
  maxFanIn: number;
  maxFanInLabel: string;
  modules: number;
};

/** A solved issue's fix, from lib/recs/similar.ts. */
export type FixOutcome = { fixFiles: number | null; fixAdd: number | null; fixDel: number | null; reviewRounds: number | null };

export type Difficulty = {
  /** 1 (easiest) to 5. */
  difficulty: number;
  /** The unrounded score, for calibration's ranking. */
  score: number;
  reasons: string[];
};

const REPRO = /\b(steps to reproduce|to reproduce|reproduc(?:e|tion|ible) (?:example|case|script)|minimal (?:example|repro)|mre|repro)\b/i;
const STACK_TRACE = /Traceback \(most recent call last\)|^\s+at [\w$.<>]+ ?\(.*:\d+(?::\d+)?\)|panicked at|Exception in thread|^\s*File "[^"]+", line \d+/m;

export function contentSignals(body: string): Pick<DifficultyFeatures, "bodyLength" | "codeBlocks" | "hasRepro" | "hasStackTrace"> {
  const codeBlocks = (body.match(/```[\s\S]*?```/g) ?? []).length;
  return { bodyLength: body.length, codeBlocks, hasRepro: REPRO.test(body), hasStackTrace: STACK_TRACE.test(body) };
}

/** Graph features for the nodes an issue touches. `fanInCache` is shared
 *  across one repo's issues: dependentsByHop walks the whole graph each call.
 *  `modules` comes from buildModuleMap, also once per repo. */
export function graphSignals(graph: GraphData, nodeIds: string[], fanInCache: Map<string, number>, modules: Map<number, string> = buildModuleMap(graph)): GraphSignals | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const touched = nodeIds.map((id) => byId.get(id)).filter((node) => node !== undefined);
  if (!touched.length) return null;
  let maxFanIn = 0;
  let maxFanInLabel = "";
  for (const node of touched) {
    let fanIn = fanInCache.get(node.id);
    if (fanIn === undefined) {
      fanIn = dependentsByHop(graph, node.id).reduce((sum, hop) => sum + hop.length, 0);
      fanInCache.set(node.id, fanIn);
    }
    if (fanIn > maxFanIn) { maxFanIn = fanIn; maxFanInLabel = node.label; }
  }
  return { nodes: touched.length, maxFanIn, maxFanInLabel, modules: new Set(touched.map((node) => modules.get(node.community) ?? node.community)).size };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const range = (values: number[]) => {
  const low = Math.min(...values), high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
};

/** `neighbours` are the nearest solved issues (with merged fixes), nearest first. */
export function scoreDifficulty(f: DifficultyFeatures, ageDays: number, neighbours: FixOutcome[]): Difficulty {
  const reasons: string[] = [];
  let score: number = W.base;

  // Outcome prior: replaces the base when enough solved neighbours exist.
  const solved = neighbours.slice(0, W.neighbours).filter((n) => n.fixFiles !== null && n.fixAdd !== null && n.fixDel !== null);
  if (solved.length >= W.minNeighbours) {
    const lines = median(solved.map((n) => n.fixAdd! + n.fixDel!));
    const files = solved.map((n) => n.fixFiles!);
    score = W.priorLines.find(([max]) => lines <= max)?.[1] ?? W.priorLinesAbove;
    reasons.push(`similar fixes touched ${range(files)} file${Math.max(...files) === 1 ? "" : "s"}, about ${plural(Math.round(lines), "line")}`);
    if (median(files) >= W.priorManyFiles) score += W.priorManyFilesPts;
    const reviews = solved.map((n) => n.reviewRounds).filter((r): r is number => r !== null);
    if (reviews.length && median(reviews) >= W.priorReviews) {
      score += W.priorReviewsPts;
      reasons.push(`similar fixes went through ${Math.round(median(reviews))} review rounds`);
    }
  }

  const labels = new Set(f.labels);
  const has = (re: RegExp) => [...labels].some((label) => re.test(label));
  if (has(/\b(docs?|documentation)\b/)) { score += W.docsPts; reasons.push("documentation change"); }
  if (has(/good.?first.?issue|first.?timers?.?only|beginner|starter|easy/)) { score += W.goodFirstPts; reasons.push("maintainers marked it beginner-friendly"); }
  if (f.hasRepro) { score += W.reproPts; reasons.push("includes steps to reproduce"); }
  if (f.hasStackTrace) { score += W.stackTracePts; reasons.push("includes a stack trace pointing at the failure"); }
  if (f.reporterIsMaintainer) { score += W.maintainerReporterPts; reasons.push("filed by a maintainer, so the ask is precise"); }
  if (f.bodyLength > W.longBody) { score += W.longBodyPts; reasons.push("long, detailed report to digest"); }
  if (f.codeBlocks > 1) score += W.codeBlocksPts;
  if (f.repoStars >= W.bigRepoStars) { score += W.bigRepoPts; reasons.push("large project with a high review bar"); }

  if (f.comments >= W.manyComments) { score += W.manyCommentsPts; reasons.push(`long discussion (${plural(f.comments, "comment")})`); }
  if (f.participants >= W.manyParticipants) score += W.manyParticipantsPts;
  if (f.attempts > 0) { score += W.attemptsPts; reasons.push(`${plural(f.attempts, "earlier pull request")} closed without merging`); }
  if (ageDays >= W.oldDays) { score += W.oldPts; reasons.push("open for over a year"); }

  if (f.graph) {
    if (f.graph.maxFanIn >= W.fanIn) { score += W.fanInPts; reasons.push(`touches ${f.graph.maxFanInLabel}, which ${f.graph.maxFanIn} other parts depend on`); }
    if (f.graph.modules >= W.modules) { score += W.modulesPts; reasons.push(`spans ${f.graph.modules} modules`); }
  }

  return { difficulty: Math.min(5, Math.max(1, Math.round(score))), score, reasons };
}

/** Spearman's rank correlation, with average ranks for ties. Throws on
 *  mismatched or too-short input instead of returning a meaningless number. */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error("spearman needs two lists of the same length");
  if (xs.length < 3) throw new Error("spearman needs at least 3 pairs");
  const rank = (values: number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
      for (let k = i; k <= j; k++) ranks[order[k].index] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs), ry = rank(ys);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (!dx || !dy) return 0; // one side is constant: no ranking signal at all
  return num / Math.sqrt(dx * dy);
}
