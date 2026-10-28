import { test } from "node:test";
import assert from "node:assert/strict";
import { s4, S4_COPIED } from "../lesson/steps/s4";
import { StepInputError, type StepContext } from "../lesson/steps";
import { ReplyFormatError } from "../understanding";

const ISSUE = "After logging in, the app redirects to /home but the session cookie is missing, so the user is logged out again. Expected: the cookie is set on the redirect response. Flask 3.0, Python 3.12.";
const ctx: StepContext = {
  repo: "pallets/flask", issue: { number: 5, title: "Session lost on redirect", body: ISSUE }, readme: "", graph: null,
  answerKey: { diff: "+x", diagnosis: "save_session skips writing the cookie when the session was not modified, even on redirects.", cases: [], title: "Keep the session on redirect" },
  answerKeyStatus: "verified",
};
const OWN = "When a view logs someone in and then redirects, the browser never receives the session cookie, so the next page treats them as logged out. It should keep them logged in. Anyone with a login-then-redirect flow hits it. To reproduce: a view that sets session['user'] and returns redirect('/home'), then check the response headers for Set-Cookie.";

test("s4 needs a real answer", () => {
  assert.equal(s4.parseAnswer(OWN), OWN);
  assert.throws(() => s4.parseAnswer("It breaks."), StepInputError);
});

test("s4 turns back a copy of the issue before any model call", () => {
  assert.deepEqual(s4.grade(ctx, ISSUE), { passed: false, feedback: S4_COPIED });
  assert.equal(s4.grade(ctx, OWN), null);
});

test("s4's grader sees the hidden diagnosis but is told never to reveal it", () => {
  const p = s4.prompt!(ctx, OWN);
  assert.match(p.user, /<diagnosis untrusted="true">\nsave_session skips/);
  assert.match(p.system, /never quote or hint at it/);
  assert.match(p.system, /Do not mention files, functions or the fix/);
  assert.match(s4.prompt!({ ...ctx, answerKey: null }, OWN).user, /<diagnosis untrusted="true">\n\(not provided\)/, "no key yet: graded on the issue");
});

test("s4 passes on behaviour and a plausible repro", () => {
  const reply = (o: object) => JSON.stringify({ behaviour: true, repro: true, feedback: "Good.", ...o });
  assert.equal(s4.parseGrade!(reply({}), OWN).passed, true);
  assert.equal(s4.parseGrade!(reply({ repro: false }), OWN).passed, false);
  assert.throws(() => s4.parseGrade!(reply({ behaviour: 1 }), OWN), ReplyFormatError);
});
