import { test } from "node:test";
import assert from "node:assert/strict";
import type { GraphData } from "../graph";
import { contentSignals, graphSignals, scoreDifficulty, spearman, type DifficultyFeatures, type FixOutcome } from "../recs/difficulty";

const base: DifficultyFeatures = {
  bodyLength: 400, codeBlocks: 0, hasRepro: false, hasStackTrace: false, labels: [],
  reporterIsMaintainer: false, repoStars: 5_000, comments: 2, participants: 2, attempts: 0, graph: null,
};
const fix = (files: number, add: number, del: number, reviewRounds: number | null = 1): FixOutcome => ({ fixFiles: files, fixAdd: add, fixDel: del, reviewRounds });

test("contentSignals: code blocks, repro steps and stack traces", () => {
  const body = "Steps to reproduce:\n```py\nimport attr\n```\n```\nTraceback (most recent call last):\n  File \"x.py\", line 3, in <module>\n```";
  assert.deepEqual(contentSignals(body), { bodyLength: body.length, codeBlocks: 2, hasRepro: true, hasStackTrace: true });
  assert.deepEqual(contentSignals(""), { bodyLength: 0, codeBlocks: 0, hasRepro: false, hasStackTrace: false });
  assert.equal(contentSignals("    at Object.<anonymous> (/app/index.js:10:5)").hasStackTrace, true);
});

test("scoreDifficulty: no signals and no neighbours is the base, 2", () => {
  assert.deepEqual(scoreDifficulty(base, 10, []), { difficulty: 2, score: 2, reasons: [] });
});

test("scoreDifficulty: the outcome prior sets the base and explains itself", () => {
  const small = scoreDifficulty(base, 10, [fix(1, 3, 1), fix(2, 5, 0), fix(1, 2, 2)]);
  assert.equal(small.difficulty, 1);
  assert.deepEqual(small.reasons, ["similar fixes touched 1–2 files, about 4 lines"]);

  const big = scoreDifficulty(base, 10, [fix(6, 400, 200, 4), fix(5, 300, 100, 3), fix(8, 900, 50, 5)]);
  assert.equal(big.difficulty, 5);
  assert.ok(big.reasons.includes("similar fixes went through 4 review rounds"));
});

test("scoreDifficulty: one neighbour is not enough for a prior", () => {
  assert.equal(scoreDifficulty(base, 10, [fix(9, 900, 900)]).difficulty, 2);
  // Neighbours with unknown fix sizes don't count either.
  assert.equal(scoreDifficulty(base, 10, [{ fixFiles: null, fixAdd: null, fixDel: null, reviewRounds: null }, fix(9, 900, 900)]).difficulty, 2);
});

test("scoreDifficulty: content, background, dynamics and graph each move it", () => {
  const easy = scoreDifficulty({ ...base, labels: ["documentation", "good first issue"], hasRepro: true, reporterIsMaintainer: true }, 10, []);
  assert.equal(easy.difficulty, 1);
  assert.deepEqual(easy.reasons, ["documentation change", "maintainers marked it beginner-friendly", "includes steps to reproduce", "filed by a maintainer, so the ask is precise"]);

  const hard = scoreDifficulty({
    ...base, bodyLength: 3_000, repoStars: 50_000, comments: 25, participants: 9, attempts: 2,
    graph: { nodes: 6, maxFanIn: 14, maxFanInLabel: "Session.request()", modules: 4 },
  }, 500, []);
  assert.equal(hard.difficulty, 5);
  assert.ok(hard.reasons.includes("touches Session.request(), which 14 other parts depend on"));
  assert.ok(hard.reasons.includes("2 earlier pull requests closed without merging"));
  assert.ok(hard.reasons.includes("open for over a year"));
  assert.ok(hard.score > 5); // clamped
});

test("graphSignals: fan-in from dependents, modules spanned, cached per node", () => {
  const graph: GraphData = {
    nodes: [
      { id: "core", label: "core()", community: 0, file_type: "code", source_file: "src/core.py" },
      { id: "a", label: "a()", community: 1, file_type: "code", source_file: "src/a.py" },
      { id: "b", label: "b()", community: 2, file_type: "code", source_file: "src/b.py" },
    ],
    links: [
      { source: "a", target: "core", relation: "calls", confidence: "EXTRACTED", confidence_score: 1, source_file: "src/a.py" },
      { source: "b", target: "a", relation: "calls", confidence: "EXTRACTED", confidence_score: 1, source_file: "src/b.py" },
    ],
  };
  const cache = new Map<string, number>();
  assert.deepEqual(graphSignals(graph, ["core", "b", "missing"], cache), { nodes: 2, maxFanIn: 2, maxFanInLabel: "core()", modules: 2 });
  assert.equal(cache.get("core"), 2);
  assert.equal(graphSignals(graph, ["missing"], cache), null);
  assert.equal(graphSignals(graph, [], cache), null);
});

test("spearman: perfect, inverse, ties and bad input", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 0.9487) < 1e-3);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0);
  assert.throws(() => spearman([1, 2], [1, 2]), /at least 3/);
  assert.throws(() => spearman([1, 2, 3], [1, 2]), /same length/);
});
