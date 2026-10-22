import { test } from "node:test";
import assert from "node:assert/strict";
import { generateFollowUps } from "../graph-view";

test("follow-ups name the symbols and module the answer listed", () => {
  assert.deepEqual(generateFollowUps("god nodes", "Top nodes:\n  -> truncate()\n  -> slugify"), ["trace truncate", "impact truncate", "stats"]);
  assert.equal(generateFollowUps("stats", "Modules:\n  src/text/truncate.ts: 12 nodes")[1], "explain src/text/truncate.ts");
  assert.equal(generateFollowUps("stats", "no modules")[1], "explain src");
});

test("follow-ups stay fast on a hostile answer of blank lines", () => {
  for (const query of ["god nodes", "stats"]) {
    const started = Date.now();
    generateFollowUps(query, "\n".repeat(100_000) + "x");
    assert.ok(Date.now() - started < 1000, `${query} took ${Date.now() - started} ms`);
  }
});
