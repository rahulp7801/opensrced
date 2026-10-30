import { test } from "node:test";
import assert from "node:assert/strict";
import { GOOD_QUESTION_EXAMPLE, s5, vagueReason } from "../lesson/steps/s5";
import { StepInputError, type StepContext } from "../lesson/steps";

const ctx: StepContext = { repo: "o/r", issue: { number: 1, title: "", body: "" }, readme: "", graph: null, answerKey: null, answerKeyStatus: "pending" };

test("vague questions are named for what is wrong with them", () => {
  for (const vague of ["I don't get it", "How does this work?", "what do I do", "Where should I start?", "Can you explain?", "Why?", "The cookie thing"]) {
    assert.ok(vagueReason(vague), vague);
  }
  for (const good of [
    "When the response is a redirect, is the session cookie still written?",
    "Why does should_set_cookie return false after login?",
    "Is SESSION_REFRESH_EACH_REQUEST meant to cover redirects too?",
  ]) assert.equal(vagueReason(good), null, good);
});

test("s5 passes with at least one specific question, and bounces vague ones with an example", () => {
  const all = s5.grade(ctx, s5.parseAnswer("- I don't get it\n- How does this work?"));
  assert.equal(all?.passed, false);
  assert.ok(all!.feedback.includes(GOOD_QUESTION_EXAMPLE));
  const mixed = s5.grade(ctx, s5.parseAnswer("I don't get it\nWhen the response is a redirect, is the session cookie still written?"));
  assert.equal(mixed?.passed, true);
  assert.match(mixed!.feedback, /Some are too vague/);
  assert.equal(s5.grade(ctx, ["Why does should_set_cookie return false after login?"])?.passed, true);
});

test("s5 input: one question per line, at most 8", () => {
  assert.deepEqual(s5.parseAnswer("1. a?\r\n\n2) b?"), ["a?", "b?"]);
  for (const bad of ["", "\n \n", Array(9).fill("q?").join("\n"), "x".repeat(401), null]) assert.throws(() => s5.parseAnswer(bad), StepInputError);
});
