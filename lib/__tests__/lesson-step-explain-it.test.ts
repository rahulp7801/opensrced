import { test } from "node:test";
import assert from "node:assert/strict";
import { explainIt, PRACTICE_NEEDED } from "../lesson/steps/explain-it";
import { StepInputError, type StepContext } from "../lesson/steps";

const DIFF = "--- a/src/flask/sessions.py\n+++ b/src/flask/sessions.py\n@@ -1 +1,2 @@\n+x = 1\n--- a/tests/test_sessions.py\n+++ b/tests/test_sessions.py\n@@ -0,0 +1 @@\n+def test_x(): pass\n";
const ctx: StepContext = {
  repo: "pallets/flask", issue: { number: 5, title: "", body: "" }, readme: "", graph: null,
  answerKey: { diff: DIFF, diagnosis: "The session interface skips writing the cookie when the response is a redirect.", cases: [], title: "Keep the session on redirect" },
  answerKeyStatus: "verified", practiced: 2,
};
const answer = {
  files: {
    "src/flask/sessions.py": "It now writes the cookie for redirect responses too, so the login survives.",
    "tests/test_sessions.py": "It adds a test that logs in through a redirect and checks the cookie header.",
  },
  test: "The test logs in through a view that redirects and checks Set-Cookie; without the fix that header is missing, so it fails.",
};

test("explain-it input: a sentence per file and the test explanation", () => {
  assert.deepEqual(explainIt.parseAnswer(answer), answer);
  for (const bad of [null, "text", { files: [], test: answer.test }, { files: {}, test: answer.test }, { files: answer.files, test: "short" }, { files: { a: 5 }, test: answer.test }]) {
    assert.throws(() => explainIt.parseAnswer(bad), StepInputError, JSON.stringify(bad)?.slice(0, 40));
  }
});

test("explain-it checks every changed file, copies and practice before the model", () => {
  assert.equal(explainIt.grade(ctx, answer), null, "all deterministic parts pass: the model judges the test part");
  const missing = explainIt.grade(ctx, { ...answer, files: { "src/flask/sessions.py": answer.files["src/flask/sessions.py"] } });
  assert.match(missing!.feedback, /tests\/test_sessions\.py/);
  const copied = explainIt.grade(ctx, { ...answer, test: `${ctx.answerKey!.diagnosis} ${ctx.answerKey!.diagnosis}` });
  assert.match(copied!.feedback, /repeats the AI's own description/);
  const unpractised = explainIt.grade({ ...ctx, practiced: PRACTICE_NEEDED - 1 }, answer);
  assert.match(unpractised!.feedback, /practice review questions/);
  assert.equal(explainIt.grade({ ...ctx, answerKey: null }, answer)?.passed, false);
});

test("explain-it's model part: does the explanation say why the test proves the fix", () => {
  const p = explainIt.prompt!(ctx, answer);
  assert.match(p.user, /<contributor-answer untrusted="true">\nThe test logs in/);
  assert.equal(explainIt.parseGrade!('{"proves":true,"feedback":"Yes."}', answer).passed, true);
  assert.equal(explainIt.parseGrade!('{"proves":false,"feedback":"Say why it fails before."}', answer).passed, false);
});
