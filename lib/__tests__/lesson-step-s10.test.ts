import { test } from "node:test";
import assert from "node:assert/strict";
import { s10 } from "../lesson/steps/s10";
import { stepDef, StepInputError } from "../lesson/steps";
import { isGraded, STEP_IDS } from "../lesson/machine";

test("s10 keeps the contributor's next steps, ungraded", () => {
  assert.equal(s10.parseAnswer("Watch the PR, then try #812."), "Watch the PR, then try #812.");
  assert.throws(() => s10.parseAnswer(" "), StepInputError);
  assert.equal(isGraded("s10", "verified"), false);
});

test("every step id has a definition with a question and hints", () => {
  for (const id of STEP_IDS) {
    const def = stepDef(id);
    assert.equal(def.id, id);
    assert.ok(def.question && def.hintQuestion && def.nudge, id);
    // A model-graded step has both halves; the rest have neither.
    assert.equal(Boolean(def.prompt), Boolean(def.parseGrade), id);
  }
});
