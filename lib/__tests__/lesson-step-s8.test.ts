import { test } from "node:test";
import assert from "node:assert/strict";
import { s8 } from "../lesson/steps/s8";
import { StepInputError, type StepContext } from "../lesson/steps";
import { ReplyFormatError } from "../understanding";

const ctx: StepContext = {
  repo: "pallets/flask", issue: { number: 5, title: "Session lost on redirect", body: "The cookie is missing after a redirect." }, readme: "", graph: null,
  answerKey: { diff: "+        is_redirect = 300 <= response.status_code < 400", diagnosis: "should_set_cookie ignores redirects.", cases: [{ variant: "login then redirect", test: "test_cookie_on_redirect" }], title: "t" },
  answerKeyStatus: "verified",
};
const PLAN = "The cookie decision ignores redirect responses, so after login the redirect goes out without Set-Cookie. I would make the save step also write the cookie for 3xx responses. A test: log in through a view that redirects, then assert the response has a Set-Cookie header; it fails today.";

test("s8 needs a real plan", () => {
  assert.equal(s8.parseAnswer(PLAN), PLAN);
  assert.throws(() => s8.parseAnswer("change the code"), StepInputError);
});

test("s8's grader gets the answer key fenced, accepts other approaches, and must not reveal the key", () => {
  assert.equal(s8.grade(ctx, PLAN), null, "an own plan goes to the model");
  const p = s8.prompt!(ctx, PLAN);
  assert.match(p.user, /<answer-key>\n<diagnosis untrusted="true">[\s\S]*<cases untrusted="true">\n- login then redirect -> test_cookie_on_redirect[\s\S]*<diff untrusted="true">\n\+\s+is_redirect[\s\S]*<\/answer-key>/);
  assert.match(p.system, /Another approach that would also fix the issue is correct/);
  assert.match(p.system, /never name its files, functions or lines/);
  assert.equal(s8.grade({ ...ctx, answerKey: null }, PLAN), null);
  assert.equal(s8.grade(ctx, `${ctx.issue.body} ${ctx.issue.body} ${ctx.issue.body}`)?.passed, false, "a copy of the issue is turned back");
});

test("s8 passes on the cause plus the change or the proof", () => {
  const reply = (o: object) => JSON.stringify({ cause: true, change: false, proof: true, alternative: false, feedback: "Good test idea.", ...o });
  assert.equal(s8.parseGrade!(reply({}), PLAN).passed, true);
  assert.equal(s8.parseGrade!(reply({ proof: false, change: true }), PLAN).passed, true);
  assert.equal(s8.parseGrade!(reply({ proof: false }), PLAN).passed, false);
  assert.equal(s8.parseGrade!(reply({ cause: false, change: true }), PLAN).passed, false, "the cause is required");
  assert.deepEqual((s8.parseGrade!(reply({ alternative: true }), PLAN).detail as { alternative: boolean }).alternative, true);
  assert.throws(() => s8.parseGrade!(reply({ alternative: "maybe" }), PLAN), ReplyFormatError);
});
