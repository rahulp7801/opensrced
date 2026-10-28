import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance, canReveal, canSubmit, canTransition, isGraded, isStepId, nextStageOf, requiredSteps, stageComplete, stepsInStage,
  STAGES, STEP_IDS, type AnswerKeyStatus, type StepId,
} from "../lesson/machine";

const done = (...ids: StepId[]) => Object.fromEntries(ids.map((id) => [id, { done: true }]));

test("short mode asks for s1, s4, s7, s8 before the reveal; full mode for every kickoff step", () => {
  assert.deepEqual(requiredSteps("short"), ["s1", "s4", "s7", "s8", "explain-it", "s10"]);
  assert.deepEqual(requiredSteps("full"), ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "explain-it", "s10"]);
  assert.deepEqual(stepsInStage("kickoff"), ["s1", "s2", "s3", "s4", "s5", "s6"]);
  assert.deepEqual(stepsInStage("reveal"), []);
});

test("s7 and s8 are graded only against a verified answer key; s2, s6, s10 never", () => {
  const keys: AnswerKeyStatus[] = ["pending", "verified", "unverified", "failed"];
  for (const key of keys) {
    assert.equal(isGraded("s7", key), key === "verified", `s7 with ${key}`);
    assert.equal(isGraded("s8", key), key === "verified", `s8 with ${key}`);
    for (const never of ["s2", "s6", "s10"] as const) assert.equal(isGraded(never, key), false);
    for (const always of ["s1", "s3", "s4", "s5", "explain-it"] as const) assert.equal(isGraded(always, key), true);
  }
});

test("a lesson moves forward through completed stages and stops at the reveal", () => {
  assert.equal(advance("kickoff", "short", "A", {}), "kickoff");
  assert.equal(advance("kickoff", "short", "A", done("s1")), "kickoff");
  assert.equal(advance("kickoff", "short", "A", done("s1", "s4")), "locate", "optional steps are not waited for");
  assert.equal(advance("kickoff", "full", "A", done("s1", "s4")), "kickoff", "full mode waits for every kickoff step");
  assert.equal(advance("kickoff", "short", "A", done("s1", "s4", "s7", "s8")), "reveal", "never past the reveal by itself");
  assert.equal(advance("kickoff", "short", "B", done("s1", "s4", "s7", "s8")), "ide", "path B writes the fix first");
  assert.equal(advance("explain", "short", "A", done("explain-it")), "next");
  assert.equal(advance("next", "short", "A", done("s10")), "done");
  assert.equal(advance("done", "short", "A", done(...STEP_IDS)), "done");
  assert.equal(stageComplete("reveal", "short", done(...STEP_IDS)), false, "action stages are left by an action");
});

test("transitions: one step forward on the lesson's path, or the give-up jump to the reveal", () => {
  assert.equal(nextStageOf("predict", "A"), "reveal");
  assert.equal(nextStageOf("predict", "B"), "ide");
  assert.equal(nextStageOf("ide", "B"), "reveal");
  assert.equal(nextStageOf("locate", "A"), "predict");
  for (let i = 0; i + 1 < STAGES.length; i++) {
    const from = STAGES[i];
    if (from === "ide") continue;
    assert.equal(canTransition(from, nextStageOf(from, "A"), "A"), true, from);
  }
  assert.equal(canTransition("kickoff", "predict", "A"), false, "no skipping");
  assert.equal(canTransition("explain", "kickoff", "A"), false, "no going back");
  assert.equal(canTransition("done", "done", "A"), false);
  assert.equal(canTransition("kickoff", "reveal", "A", true), true, "giving up jumps to the reveal");
  assert.equal(canTransition("explain", "reveal", "A", true), false);
});

test("steps can be submitted in their own stage; kickoff stays open until the reveal", () => {
  assert.equal(canSubmit("kickoff", "s1"), true);
  assert.equal(canSubmit("kickoff", "s7"), false, "no locating before the kickoff is done");
  assert.equal(canSubmit("predict", "s3"), true, "an optional kickoff step can be done late");
  assert.equal(canSubmit("explain", "s1"), false);
  assert.equal(canSubmit("predict", "s8"), true);
  assert.equal(canSubmit("predict", "explain-it"), false, "explain-it only after the reveal");
  assert.equal(canSubmit("next", "s10"), true);
});

test("the reveal needs s8 done, or an explicit give-up", () => {
  assert.equal(canReveal("reveal", false), true);
  for (const stage of ["kickoff", "locate", "predict", "ide"] as const) {
    assert.equal(canReveal(stage, false), false, stage);
    assert.equal(canReveal(stage, true), true, stage);
  }
  assert.equal(canReveal("explain", true), false, "already past it");
});

test("step ids are validated", () => {
  assert.equal(isStepId("s7"), true);
  assert.equal(isStepId("explain-it"), true);
  for (const bad of ["s9", "S1", "", null, 7, "__proto__"]) assert.equal(isStepId(bad), false, String(bad));
});
