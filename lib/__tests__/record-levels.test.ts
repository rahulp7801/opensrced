import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStats, LEVELS, qualifiedLevel, REGULAR, TRUSTED, type Level, type LevelStats } from "../record/levels";

const stats = (s: Partial<LevelStats>): LevelStats => ({ ...emptyStats(), ...s });
// Enough for regular: 3 merged in one project, one through path B, every review answered.
const regular = { mergedByRepo: { "a/x": 3 }, pathB: 1 };
const trusted = { mergedByRepo: { "a/x": 6, "b/y": 4 }, pathB: 3, approvals: 2, briefReviews: 3 };

test("qualifiedLevel: the plan's requirements, at and around each boundary", () => {
  const cases: Array<[string, Partial<LevelStats>, Level]> = [
    ["nothing", {}, "newcomer"],
    ["zero merged in a repo", { mergedByRepo: { "a/x": 0 } }, "newcomer"],
    ["1 merged through opensrcer", { mergedByRepo: { "a/x": 1 } }, "contributor"],
    ["1 merged imported", { importedMerged: 1 }, "contributor"],
    ["lots imported: imported never reaches regular", { importedMerged: 500, pathB: 5 }, "contributor"],
    ["regular: 3 in one project + path B", regular, "regular"],
    ["2 in one project is not enough", { mergedByRepo: { "a/x": 2 }, pathB: 1 }, "contributor"],
    ["regular: 5 across 2 projects", { mergedByRepo: { "a/x": 2, "b/y": 3 }, pathB: 1 }, "regular"],
    ["4 across 2 projects is not enough", { mergedByRepo: { "a/x": 2, "b/y": 2 }, pathB: 1 }, "contributor"],
    ["regular needs path B", { mergedByRepo: { "a/x": 3 }, pathB: 0 }, "contributor"],
    ["regular needs every review answered", { ...regular, unansweredReviews: 1 }, "contributor"],
    ["regular needs no spam flag", { ...regular, spamFlagged: true }, "contributor"],
    ["trusted", trusted, "trusted"],
    ["trusted needs 10 merged", { ...trusted, mergedByRepo: { "a/x": 9 } }, "regular"],
    ["trusted needs 3 path B", { ...trusted, pathB: 2 }, "regular"],
    ["trusted needs 2 approvals", { ...trusted, approvals: 1 }, "regular"],
    ["trusted needs 3 brief reviews", { ...trusted, briefReviews: 2 }, "regular"],
    ["trusted needs regular (an unanswered review)", { ...trusted, unansweredReviews: 1 }, "contributor"],
  ];
  for (const [name, s, level] of cases) assert.equal(qualifiedLevel(stats(s)), level, name);
});

test("knobs and levels are what the plan says", () => {
  assert.deepEqual(LEVELS, ["newcomer", "contributor", "regular", "trusted"]);
  assert.deepEqual(REGULAR, { mergedInOneRepo: 3, mergedAcrossRepos: 5, acrossRepos: 2, pathB: 1 });
  assert.deepEqual(TRUSTED, { merged: 10, pathB: 3, approvals: 2, briefReviews: 3 });
});
