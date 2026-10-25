import { test } from "node:test";
import assert from "node:assert/strict";
import { generateFollowUps } from "../graph-view";

test("follow-ups name the symbols and module the answer listed", () => {
  assert.deepEqual(generateFollowUps("god nodes", "Top nodes:\n  -> truncate()\n  -> slugify"), [
    "What calls truncate, and what does it call?", "What breaks if I change truncate?", "Give me an overview of this repository.",
  ]);
  assert.equal(generateFollowUps("stats", "Modules:\n  src/text/truncate.ts: 12 nodes")[1], "What does src/text/truncate.ts do?");
  assert.equal(generateFollowUps("stats", "no modules")[1], "What does src do?");
});

test("follow-ups are plain English, never commands", () => {
  for (const query of ["Where is the config read?", "help", "trace foo", "impact foo", "path a to b", "explain src"]) {
    for (const q of generateFollowUps(query, "  -> foo()\n  -> bar\nsrc/api/x.ts")) {
      assert.match(q, /^[A-Z].*[?.]$/, q);
      assert.doesNotMatch(q, /^(trace|impact|explain|path|help|stats|god nodes)\b/i, q);
    }
  }
});

test("follow-ups stay fast on a hostile answer of blank lines", () => {
  for (const query of ["god nodes", "stats"]) {
    const started = Date.now();
    generateFollowUps(query, "\n".repeat(100_000) + "x");
    assert.ok(Date.now() - started < 1000, `${query} took ${Date.now() - started} ms`);
  }
});
