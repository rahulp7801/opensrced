import { test } from "node:test";
import assert from "node:assert/strict";
import { s6 } from "../lesson/steps/s6";
import { StepInputError } from "../lesson/steps";
import { isGraded } from "../lesson/machine";

test("s6 keeps notes and is never graded", () => {
  assert.equal(s6.parseAnswer(" #4521 fixed a similar cookie bug in sessions. "), "#4521 fixed a similar cookie bug in sessions.");
  assert.throws(() => s6.parseAnswer(""), StepInputError);
  assert.throws(() => s6.parseAnswer("x".repeat(3001)), StepInputError);
  assert.equal(isGraded("s6", "verified"), false);
  assert.equal(s6.prompt, undefined);
});
