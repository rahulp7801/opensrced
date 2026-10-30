import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLeak, fileNamesUnlocked, hiddenDiffFacts, symbolsUnlocked, type LeakGate } from "../lesson/leak";

// A Flask-style fix: the session cookie was not written on redirects.
const DIFF = `diff --git a/src/flask/sessions.py b/src/flask/sessions.py
--- a/src/flask/sessions.py
+++ b/src/flask/sessions.py
@@ -340,7 +340,9 @@ def save_session(self, app, session, response):
         if not session:
             return
-        if not self.should_set_cookie(app, session):
+        is_redirect = 300 <= response.status_code < 400
+        if not self.should_set_cookie(app, session) and not is_redirect:
             return
         response.set_cookie(name, val, expires=expires)
diff --git a/tests/test_sessions.py b/tests/test_sessions.py
--- a/tests/test_sessions.py
+++ b/tests/test_sessions.py
@@ -1,3 +1,10 @@
+def test_cookie_written_on_redirect(app, client):
+    response = client.get("/login-then-redirect")
+    assert "session" in response.headers["Set-Cookie"]
`;

const kickoff: LeakGate = { stage: "kickoff", revealed: false, s7HintLevel: -1, s8HintLevel: -1, s7Done: false };

test("the diff's facts: added lines (minus pre-existing ones), files and symbols", () => {
  const facts = hiddenDiffFacts(DIFF);
  assert.deepEqual(facts.files, ["src/flask/sessions.py", "tests/test_sessions.py"]);
  assert.ok(facts.symbols.includes("save_session"), "the hunk header names the enclosing function");
  assert.ok(facts.symbols.includes("test_cookie_written_on_redirect"), "an added definition");
  assert.ok(facts.addedLines.some((l) => l.startsWith("is_redirect = 300")));
  assert.ok(!facts.addedLines.includes("return"), "lines too short to mean anything are skipped");
  assert.deepEqual(hiddenDiffFacts(""), { addedLines: [], files: [], symbols: [] });
});

test("should block: replies that quote the fix or name what is still hidden", () => {
  const blocked: Array<[string, RegExp, string?]> = [
    ["Try adding `is_redirect = 300 <= response.status_code < 400` before the check.", /quotes an added line/],
    ["The condition should be: if not self.should_set_cookie(app, session) and not is_redirect then return.", /quotes an added line/],
    ["Have a look at src/flask/sessions.py, it decides when cookies are written.", /names a changed file: src\/flask\/sessions\.py/],
    ["Open sessions.py and read the cookie logic.", /names a changed file: sessions\.py/],
    ["What does save_session do when the response is a redirect?", /names a changed symbol: save_session/],
    ["The new test, test_cookie_written_on_redirect, would check it.", /names a changed (symbol|file)/],
    ["A test could do: response = client.get(\"/login-then-redirect\") and then assert \"session\" in response.headers[\"Set-Cookie\"].", /quotes an added line/],
  ];
  for (const [reply, reason] of blocked) {
    const result = checkLeak(reply, DIFF, kickoff);
    assert.equal(result.leak, true, reply);
    assert.ok(result.reasons.some((r) => reason.test(r)), `${reply} -> ${result.reasons.join(" | ")}`);
  }
});

test("should allow: Socratic questions about behaviour and areas", () => {
  const allowed = [
    "What happens to the cookie when the response is a redirect? Which part of the code builds responses?",
    "Good thinking. Where in the session handling would you look first, and why?",
    "Look at how the framework decides whether to write a cookie at all. What conditions does it check?",
    "Try reproducing it: log in, get redirected, and look at the response headers. Is there a Set-Cookie header?",
    "You are right that the status code matters. What range of status codes counts as a redirect?",
    // An English word that is also a short symbol does not trip unless written as code.
    "Which session settings could change this?",
  ];
  for (const reply of allowed) assert.deepEqual(checkLeak(reply, DIFF, kickoff), { leak: false, reasons: [] }, reply);
});

test("names the contributor wrote first are theirs to discuss", () => {
  const reply = "Yes, sessions.py is a good place. What does save_session check first?";
  assert.equal(checkLeak(reply, DIFF, kickoff).leak, true);
  assert.equal(checkLeak(reply, DIFF, kickoff, "I think sessions.py and save_session are involved").leak, false);
  // Code is never theirs: quoting the fix stays a leak whatever they wrote.
  assert.equal(checkLeak("Write `is_redirect = 300 <= response.status_code < 400`.", DIFF, kickoff, "is_redirect = 300 <= response.status_code < 400").leak, true);
});

test("unlocks follow the hint ladder: files at s7 level 2, symbols only at s8 level 3, everything at the reveal", () => {
  const atS7L2: LeakGate = { ...kickoff, stage: "locate", s7HintLevel: 2 };
  assert.equal(fileNamesUnlocked(atS7L2), true);
  assert.equal(symbolsUnlocked(atS7L2), false);
  assert.equal(checkLeak("Open src/flask/sessions.py.", DIFF, atS7L2).leak, false);
  assert.equal(checkLeak("Read save_session.", DIFF, atS7L2).leak, true);

  assert.equal(fileNamesUnlocked({ ...kickoff, stage: "locate", s7HintLevel: 1 }), false, "level 1 is the area, not the file");
  assert.equal(fileNamesUnlocked({ ...kickoff, stage: "predict", s7Done: true }), true, "s7's grading already pointed at the files");
  assert.equal(fileNamesUnlocked({ ...kickoff, stage: "locate", s7Done: true }), false);

  const atS8L3: LeakGate = { ...kickoff, stage: "predict", s7Done: true, s8HintLevel: 3 };
  assert.equal(checkLeak("Read save_session in sessions.py.", DIFF, atS8L3).leak, false);
  assert.equal(checkLeak("Add `is_redirect = 300 <= response.status_code < 400`.", DIFF, atS8L3).leak, true, "code stays hidden until the reveal");

  const revealed: LeakGate = { ...kickoff, stage: "explain", revealed: true };
  assert.deepEqual(checkLeak("is_redirect = 300 <= response.status_code < 400 in save_session", DIFF, revealed), { leak: false, reasons: [] });
});

test("an empty diff hides nothing", () => {
  assert.equal(checkLeak("Look at src/flask/sessions.py", "", kickoff).leak, false);
});
