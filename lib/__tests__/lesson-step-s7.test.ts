import { test } from "node:test";
import assert from "node:assert/strict";
import { gradePicks, picksPass, s7 } from "../lesson/steps/s7";
import { StepInputError, type StepContext } from "../lesson/steps";
import type { GraphData } from "../graph";

// app.py --calls--> sessions.py:save_session <--calls-- wrappers.py ... cli.py stands apart.
const n = (id: string, label: string, file: string) => ({ id, label, community: 1, file_type: "code", source_file: file });
const graph = {
  nodes: [
    n("save", "save_session()", "src/flask/sessions.py"),
    n("iface", "SessionInterface", "src/flask/sessions.py"),
    n("process", "process_response()", "src/flask/app.py"),
    n("full", "full_dispatch_request()", "src/flask/app.py"),
    n("wsgi", "wsgi_app()", "src/flask/wsgi.py"),
    n("resp", "Response", "src/flask/wrappers.py"),
    n("cli", "run_command()", "src/flask/cli.py"),
    n("far", "far_away()", "src/flask/far.py"),
  ],
  links: [
    { source: "process", target: "save", relation: "calls" },
    { source: "full", target: "process", relation: "calls" },
    { source: "wsgi", target: "full", relation: "calls" },
    { source: "resp", target: "save", relation: "references" },
    { source: "cli", target: "far", relation: "calls" },
  ],
} as unknown as GraphData;
const DIFF = "--- a/src/flask/sessions.py\n+++ b/src/flask/sessions.py\n@@ -340,3 +340,4 @@ def save_session(self, app, session, response):\n-        x = 1\n+        x = 2\n";
const ctx: StepContext = { repo: "pallets/flask", issue: { number: 1, title: "", body: "" }, readme: "", graph, answerKey: { diff: DIFF, diagnosis: "", cases: [], title: "" }, answerKeyStatus: "verified" };

test("picks are on target, close (within 2 hops) or red herrings, by graph distance", () => {
  const results = gradePicks(graph, DIFF, ["src/flask/sessions.py", "save_session", "process_response", "full_dispatch_request", "src/flask/wsgi.py", "run_command", "flask/wrappers.py", "nonexistent_thing"]);
  assert.deepEqual(results.map((r) => [r.pick, r.verdict, r.hops]), [
    ["src/flask/sessions.py", "on_target", 0],
    ["save_session", "on_target", 0],
    ["process_response", "close", 1],
    ["full_dispatch_request", "close", 2],
    ["src/flask/wsgi.py", "red_herring", null],
    ["run_command", "red_herring", null],
    ["flask/wrappers.py", "close", 1],
    ["nonexistent_thing", "red_herring", null],
  ]);
});

test("a suffix path or a qualified symbol still counts; no graph still finds the changed file", () => {
  assert.equal(gradePicks(graph, DIFF, ["sessions.py"])[0].verdict, "on_target");
  assert.equal(gradePicks(graph, DIFF, ["SecureCookieSessionInterface.save_session()"])[0].verdict, "on_target");
  assert.deepEqual(gradePicks(null, DIFF, ["src/flask/sessions.py", "process_response"]).map((r) => r.verdict), ["on_target", "red_herring"]);
});

test("pass = one on target, or two close", () => {
  const r = (verdict: "on_target" | "close" | "red_herring") => ({ pick: "x", verdict, hops: null });
  assert.equal(picksPass([r("on_target"), r("red_herring"), r("red_herring")]), true);
  assert.equal(picksPass([r("close"), r("close"), r("red_herring")]), true);
  assert.equal(picksPass([r("close"), r("red_herring"), r("red_herring")]), false);
  assert.equal(picksPass([]), false);
});

test("s7 grades without a model and explains each pick", () => {
  const grade = s7.grade(ctx, s7.parseAnswer("process_response\nfull_dispatch_request\nrun_command"));
  assert.equal(grade?.passed, true);
  assert.match(grade!.feedback, /process_response: close \(1 step away\); full_dispatch_request: close \(2 steps away\); run_command: a red herring/);
  assert.equal(s7.grade(ctx, ["run_command", "src/flask/wsgi.py", "far_away"])?.passed, false);
  assert.equal(s7.grade({ ...ctx, answerKey: null }, ["a", "b", "c"]), null, "no answer key: not graded");
  assert.equal(s7.prompt, undefined);
});

test("s7 needs three different picks", () => {
  assert.deepEqual(s7.parseAnswer("- a.py\n2. b()\nc, d"), ["a.py", "b()", "c", "d"]);
  assert.deepEqual(s7.parseAnswer(["a", "b", "c"]), ["a", "b", "c"]);
  for (const bad of ["a\nb", "a\na\na", 7, Array(9).fill(0).map((_, i) => `p${i}`)]) assert.throws(() => s7.parseAnswer(bad), StepInputError);
});
