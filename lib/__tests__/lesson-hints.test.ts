import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackHint, hintFacts, hintText, maxHintLevel, nextHintLevel, withHint } from "../lesson/hints";
import { stepDef } from "../lesson/steps";
import type { LessonStep } from "../lesson/store";

const DIFF = "--- a/src/flask/sessions.py\n+++ b/src/flask/sessions.py\n@@ -1,2 +1,3 @@ def save_session(self, app):\n-    x = 1\n+    x = 2\n--- a/tests/test_sessions.py\n+++ b/tests/test_sessions.py\n@@ -0,0 +1 @@\n+def test_cookie_kept(): pass\n";

test("the ladder: s8 goes to 3, s7 to 2 (file names), other steps to a nudge", () => {
  assert.equal(maxHintLevel("s8"), 3);
  assert.equal(maxHintLevel("s7"), 2);
  assert.equal(maxHintLevel("s1"), 1);
  assert.equal(nextHintLevel("s8", -1), 0);
  assert.equal(nextHintLevel("s8", 2), 3);
  assert.equal(nextHintLevel("s8", 3), null, "used up");
  assert.equal(nextHintLevel("s7", 2), null);
  assert.equal(nextHintLevel("s4", 1), null);
  assert.equal(nextHintLevel("s4", -5), 0, "a corrupt level starts over at 0");
});

test("levels 1-3 come from the hidden diff: the area, then the file, then one symbol", () => {
  const facts = hintFacts(DIFF);
  assert.deepEqual(facts, { area: "src/flask/", file: "src/flask/sessions.py", symbol: "save_session" }, "the fix's file, not the test's");
  assert.equal(hintText("s8", 0, facts), stepDef("s8").hintQuestion);
  assert.match(hintText("s7", 1, facts), /`src\/flask\/`/);
  assert.doesNotMatch(hintText("s7", 1, facts), /sessions\.py/, "level 1 names the area, never the file");
  assert.match(hintText("s7", 2, facts), /`src\/flask\/sessions\.py` is worth a look/);
  assert.match(hintText("s8", 3, facts), /`save_session`/);
  assert.equal(hintText("s1", 1, facts), stepDef("s1").nudge, "steps that are not about location keep their nudge");
});

test("without an answer key, pointing hints fall back to the step's nudge", () => {
  const none = hintFacts(null);
  assert.deepEqual(none, { area: null, file: null, symbol: null });
  assert.equal(hintText("s7", 2, none), stepDef("s7").nudge);
  assert.equal(hintText("s8", 3, none), stepDef("s8").nudge);
  assert.equal(hintFacts("--- a/README.md\n+++ b/README.md\n+x\n").area, null, "a top-level file has no folder to point at");
});

test("hints used are stored per step, highest level kept", () => {
  const step: LessonStep = { step: "s8", answer: "", grade: null, done: false, hint_level: -1, hints_used: [], updated_at: "t" };
  const one = withHint(withHint(step, 0), 1);
  assert.equal(one.hint_level, 1);
  assert.deepEqual(one.hints_used, [0, 1]);
  assert.deepEqual(withHint(one, 1).hints_used, [0, 1], "no duplicates");
  assert.equal(withHint(one, 0).hint_level, 1, "never lowered");
});

test("the fallback hint names nothing from the fix", () => {
  assert.match(fallbackHint("s7"), new RegExp(stepDef("s7").hintQuestion.slice(0, 20).replace(/[?.]/g, "\\$&")));
  assert.match(fallbackHint(null), /what have you found so far/i);
});
