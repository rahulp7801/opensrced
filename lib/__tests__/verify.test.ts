import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boxPatch, boxRequest, initBox, startExecBox, type ExecBox } from "../exec-box";
import {
  baselineFromRuns, brokeBeforeTests, failBeforeScript, isTestPath, newFailures, parseCases, parseJestReport, parseJunitReport, parsePytestReport, parseTestReport,
  parseVerificationPlan, runVerification, testOutcome, verificationLogBlock, verificationMarkdown, type Verification,
} from "../verify";

test("parseVerificationPlan reads the last verification block only", () => {
  const log = [
    "```verification\ntest: old\n```",
    "## Verification",
    "```verification",
    "setup: python3 -m venv ~/venv",
    "test: ~/venv/bin/pytest tests/test_a.py -q",
    "lint:   ruff check a.py  ",
    "nonsense line",
    "deploy: rm -rf /",
    "```",
  ].join("\n");
  assert.deepEqual(parseVerificationPlan(log), {
    setup: ["python3 -m venv ~/venv"], test: ["~/venv/bin/pytest tests/test_a.py -q"], lint: ["ruff check a.py"],
  });
  assert.deepEqual(parseVerificationPlan("no block here"), { setup: [], test: [], lint: [] });
});

test("parseCases reads the agent's variant list; 'not covered' becomes null", () => {
  const log = "```cases\ncase: old -> t0\n```\n## Cases\n```cases\ncase: unclosed opener then real call -> test_a\ncase: opener in a code block -> not covered\nnoise\n```";
  assert.deepEqual(parseCases(log), [
    { variant: "unclosed opener then real call", test: "test_a" },
    { variant: "opener in a code block", test: null },
  ]);
  assert.deepEqual(parseCases("no cases"), []);
});

test("isTestPath recognizes pytest, unittest, jest and go conventions", () => {
  for (const p of ["tests/test_x.py", "pkg/test_x.py", "x_test.py", "a/__tests__/b.js", "src/a.test.tsx", "a.spec.ts", "conftest.py", "test/foo.py"]) assert.ok(isTestPath(p), p);
  for (const p of ["src/a.py", "vllm/attest.py", "contest.js", "lib/testing_utils.py"]) assert.ok(!isTestPath(p), p);
});

test("failBeforeScript quotes file names and restores the source change", () => {
  const script = failBeforeScript(["src/it's.py"], ["pytest a", "pytest b"]);
  assert.match(script, /'src\/it'\\''s\.py'/);
  assert.match(script, /\(pytest a\) && \(pytest b\)/);
  assert.match(script, /git apply \/tmp\/opensrcer-src\.patch \|\|/);
  assert.match(script, /exit \$rc/);
});

test("verificationMarkdown says 'not verified' plainly without evidence", () => {
  assert.match(verificationMarkdown(null), /Not verified\. No tests were run/);
  const unverified: Verification = { status: "unverified", reason: "the agent declared no test command", plan: { setup: [], test: [], lint: [] }, regression: "skipped", evidence: [] };
  assert.match(verificationMarkdown(unverified), /Not verified: the agent declared no test command/);
  assert.equal(testOutcome(unverified), "not_run");
  assert.equal(testOutcome(null), "not_run");
});

function repo(files: Record<string, string>): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-verify-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  git("add", "-A");
  git("commit", "-qm", "base");
  return { dir, sha: git("rev-parse", "HEAD") };
}

async function withBox(files: Record<string, string>, fn: (box: ExecBox) => Promise<void>) {
  const work = mkdtempSync(path.join(tmpdir(), "opensrcer-verify-work-"));
  const r = repo(files);
  let box: ExecBox | undefined;
  try {
    box = await startExecBox("host", "d_verify", work);
    await initBox(box, r.dir, r.sha);
    await fn(box);
  } finally {
    await box?.stop();
    rmSync(work, { recursive: true, force: true });
    rmSync(r.dir, { recursive: true, force: true });
  }
}

const BUGGY = { "math.js": "exports.add = (a, b) => a - b;\n" };
const TEST = "require('assert').equal(require('./math').add(2, 2), 4);\n";

test("runVerification: a real fix with a regression test is verified and reproduced", async () => {
  await withBox(BUGGY, async (box) => {
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b" });
    await boxRequest(box, "POST", "/write", { path: "math.test.js", content: TEST });
    const patch = await boxPatch(box);
    const v = await runVerification(box, { setup: [], test: ["node math.test.js"], lint: ["node --check math.js"] }, patch);
    assert.equal(v.status, "verified", JSON.stringify(v, null, 1));
    assert.equal(v.regression, "reproduced");
    assert.deepEqual(v.evidence.map((e) => e.kind), ["test", "lint", "fail-before"]);
    assert.equal(await boxPatch(box), patch, "the fail-before run restores the workspace exactly");
    assert.match(verificationMarkdown(v), /`node math\.test\.js` — passed/);
    assert.equal(testOutcome(v), "passed");
  });
});

// The pandas #71278 run: pytest exit 4 with an import error when the fix was reverted.
const PANDAS_FAIL_BEFORE = "ImportError while loading conftest '/vercel/work/pandas/conftest.py'.\npandas/__init__.py:178: in <module>\n    from pandas._version_meson import (\nE   ModuleNotFoundError: No module named 'pandas._version_meson'\n";

test("brokeBeforeTests: a run that never reached the tests is not a reproduction", () => {
  const cases: Array<[string, number | null, string, boolean]> = [
    ["python -m pytest pandas/tests/io/pytables/test_select.py", 4, PANDAS_FAIL_BEFORE, true],
    ["python -m pytest tests/test_x.py", 5, "no tests ran in 0.01s", true],
    ["python -m pytest tests/test_x.py", 2, "Interrupted: 1 error during collection", true],
    ["npx jest src/a.test.ts", 1, "FAIL src/a.test.ts\n  ● Test suite failed to run\n    Cannot find module './gen'", true],
    ["go test ./pkg/...", 1, "FAIL\texample.com/pkg [build failed]", true],
    ["cargo test", 101, "error[E0425]: cannot find value\nerror: could not compile `demo`", true],
    // Real failures: the tests ran and failed.
    ["python -m pytest tests/test_x.py", 1, "FAILED tests/test_x.py::test_add - assert 0 == 4\n1 failed in 0.02s", false],
    ["node math.test.js", 1, "AssertionError [ERR_ASSERTION]: 0 == 4", false],
    ["npx jest src/a.test.ts", 1, "FAIL src/a.test.ts\n  ✕ adds (3 ms)\n  Expected: 4\n  Received: 0", false],
    ["make test", 4, "1 failed", false],
  ];
  for (const [command, code, output, expected] of cases) assert.equal(brokeBeforeTests(command, code, output), expected, `${command} exit ${code}`);
});

test("runVerification: a test that can't even load without the fix is inconclusive, not reproduced", async () => {
  await withBox(BUGGY, async (box) => {
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b; require('./gen')" });
    await boxRequest(box, "POST", "/write", { path: "gen.js", content: "module.exports = 1;\n" });
    // With math.js reverted the test still runs, but make the reverted run break before testing:
    // the test file imports a module only the fixed source creates.
    await boxRequest(box, "POST", "/write", { path: "math.test.js", content: "require('./math'); if (!require('fs').existsSync('gen.js') || require('fs').readFileSync('math.js', 'utf8').includes('a - b')) { console.error(\"Cannot find module './generated'\"); process.exit(1); }\n" + TEST });
    const patch = await boxPatch(box);
    const v = await runVerification(box, { setup: [], test: ["node math.test.js"], lint: [] }, patch);
    assert.equal(v.status, "verified", JSON.stringify(v, null, 1));
    assert.equal(v.regression, "inconclusive");
    assert.match(verificationMarkdown(v), /could not confirm/);
  });
});

test("runVerification: failing tests and missing commands are never reported green", async () => {
  await withBox(BUGGY, async (box) => {
    await boxRequest(box, "POST", "/write", { path: "math.test.js", content: TEST });
    const patch = await boxPatch(box);
    const failed = await runVerification(box, { setup: [], test: ["node math.test.js"], lint: [] }, patch);
    assert.equal(failed.status, "failed");
    assert.match(verificationMarkdown(failed), /failed \(exit 1\)/);
    assert.equal(testOutcome(failed), "failed");
    const none = await runVerification(box, { setup: [], test: [], lint: [] }, patch);
    assert.equal(none.status, "unverified");
    const empty = await runVerification(box, { setup: [], test: ["true"], lint: [] }, "");
    assert.equal(empty.status, "unverified");
  });
});

test("runVerification: a check that rewrites files fails the gate", async () => {
  await withBox(BUGGY, async (box) => {
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b" });
    const patch = await boxPatch(box);
    const v = await runVerification(box, { setup: [], test: ["true"], lint: ["echo '// formatted' >> math.js"] }, patch);
    assert.equal(v.status, "failed");
    assert.match(v.reason, /changed the workspace/);
    assert.equal(v.regression, "no_test_change");
  });
});

// ── Baselines (PLAN §5.3) ────────────────────────────────────────────────

const PYTEST_RA = [
  "tests/test_a.py::test_one PASSED                                   [ 33%]",
  "tests/test_a.py::test_two FAILED                                   [ 66%]",
  "=========================== short test summary info ============================",
  "PASSED tests/test_a.py::test_one",
  "\x1b[31mFAILED\x1b[0m tests/test_a.py::test_two - AssertionError: assert 1 == 2",
  "FAILED tests/test_b.py::TestX::test_param[a-1] - ValueError",
  "ERROR tests/test_c.py - ImportError: no module named x",
  "==================== 2 failed, 1 passed, 1 error in 0.12s =====================",
].join("\n");

test("parsePytestReport reads -rA summaries, verbose lines and collection errors", () => {
  const r = parsePytestReport(PYTEST_RA)!;
  assert.deepEqual(r.failed.sort(), ["tests/test_a.py::test_two", "tests/test_b.py::TestX::test_param[a-1]", "tests/test_c.py"]);
  assert.deepEqual(r.passed, ["tests/test_a.py::test_one"]);
  assert.deepEqual(parsePytestReport("============ 3 passed in 0.50s ============"), { failed: [], passed: [] }, "all green is still a report");
  assert.equal(parsePytestReport("npm ERR! missing script: test"), null);
  assert.equal(parsePytestReport(""), null);
});

test("parseJunitReport reads testcases with failures, errors and skips", () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="pytest">
    <testcase classname="tests.test_a" name="test_one" time="0.1"/>
    <testcase classname="tests.test_a" name="test_&quot;two&quot;"><failure message="x">boom</failure></testcase>
    <testcase classname="tests.test_b" name="test_err"><error message="y"/></testcase>
    <testcase classname="tests.test_b" name="test_skip"><skipped/></testcase>
  </testsuite></testsuites>`;
  assert.deepEqual(parseJunitReport(xml), { failed: ['tests.test_a::test_"two"', "tests.test_b::test_err"], passed: ["tests.test_a::test_one"] });
  assert.equal(parseJunitReport("<html></html>"), null);
});

test("parseJestReport reads jest --json mixed into other output, and suites that failed to run", () => {
  const json = JSON.stringify({
    numFailedTestSuites: 2, numTotalTestSuites: 3,
    testResults: [
      { name: "/work/repo/src/a.test.js", status: "failed", assertionResults: [{ fullName: "adds numbers", status: "passed" }, { fullName: "math subtracts", status: "failed" }] },
      { name: "/work/repo/src/b.test.js", status: "failed", message: "SyntaxError", assertionResults: [] },
      { name: "/work/repo/src/c.test.js", status: "passed", assertionResults: [{ title: "only title", status: "passed" }, { fullName: "todo", status: "pending" }] },
    ],
  });
  const r = parseJestReport(`> jest --json\nnoise {not json}\n${json}\n`, "/work/repo")!;
  assert.deepEqual(r.failed, ["src/a.test.js > math subtracts", "src/b.test.js"]);
  assert.deepEqual(r.passed, ["src/a.test.js > adds numbers", "src/c.test.js > only title"]);
  assert.equal(parseJestReport('{"numFailedTestSuites": 1, broken'), null);
  assert.equal(parseJestReport("plain text"), null);
  assert.ok(parseTestReport(json)?.failed.includes("/work/repo/src/b.test.js"), "parseTestReport tries jest first; no root keeps the path");
  assert.ok(parseTestReport(PYTEST_RA)?.failed.includes("tests/test_c.py"), "then pytest");
  assert.equal(parseTestReport("make: *** [test] Error 2"), null);
});

test("baselineFromRuns unions failures and marks the ones that come and go as flaky", () => {
  const run1 = "FAILED t.py::a - x\nFAILED t.py::flaky - y\n=== 2 failed in 1s ===";
  const run2 = "FAILED t.py::a - x\n=== 1 failed, 1 passed in 1s ===";
  assert.deepEqual(baselineFromRuns([run1, run2]), { failing: ["t.py::a", "t.py::flaky"], flaky: ["t.py::flaky"] });
  assert.deepEqual(baselineFromRuns([run2]), { failing: ["t.py::a"] });
  assert.deepEqual(baselineFromRuns(["=== 5 passed in 1s ==="]), { failing: [] });
  assert.equal(baselineFromRuns(["garbage"]), null);
  assert.equal(baselineFromRuns([]), null);
});

test("newFailures splits known from new; unreadable or failure-free output gives null", () => {
  const out = "FAILED t.py::old - x\nFAILED t.py::new - y\n=== 2 failed in 1s ===";
  assert.deepEqual(newFailures(out, { failing: ["t.py::old"] }), { preexisting: ["t.py::old"], fresh: ["t.py::new"] });
  assert.deepEqual(newFailures(out, { failing: [], flaky: ["t.py::old", "t.py::new"] }), { preexisting: ["t.py::old", "t.py::new"], fresh: [] });
  assert.equal(newFailures("Segmentation fault", { failing: ["t.py::old"] }), null);
  assert.equal(newFailures("=== 3 passed in 1s ===", { failing: [] }), null);
});

// A repository whose suite has one test that always fails on main, run by a
// tiny runner that prints pytest's short summary.
const RUNNER = `const fs = require("fs");
const out = ["FAILED tests/test_old.py::test_broken - AssertionError"];
if (fs.existsSync("tests/test_math.py")) out.push(require("../math").add(2, 2) === 4 ? "PASSED tests/test_math.py::test_add" : "FAILED tests/test_math.py::test_add - assert 0 == 4");
console.log("=== short test summary info ===\\n" + out.join("\\n"));
process.exit(out.some((l) => l.startsWith("FAILED")) ? 1 : 0);
`;
const FLAKY_MAIN = { ...BUGGY, "tests/run.js": RUNNER };
const BASELINE = { failing: ["tests/test_old.py::test_broken"] };

test("runVerification with a baseline: failures already on main do not fail the patch; the new test must reproduce", async () => {
  await withBox(FLAKY_MAIN, async (box) => {
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b" });
    await boxRequest(box, "POST", "/write", { path: "tests/test_math.py", content: "# the new test\n" });
    const patch = await boxPatch(box);
    const plan = { setup: [], test: ["node tests/run.js"], lint: [] };
    const v = await runVerification(box, plan, patch, [], BASELINE);
    assert.equal(v.status, "verified", JSON.stringify(v, null, 1));
    assert.equal(v.regression, "reproduced", "the new test fails with the source change reverted");
    assert.deepEqual(v.baseline, { preexisting: ["tests/test_old.py::test_broken"], newFailures: [] });
    assert.match(v.reason, /apart from 1 test\(s\) already failing on main/);
    assert.match(verificationMarkdown(v), /Already failing on the default branch, so not counted against this patch: `tests\/test_old\.py::test_broken`/);
    assert.match(verificationLogBlock(v), /baseline: 1 already failing on main, 0 new failure\(s\)/);
    // Same patch, no baseline: the old exit-code rule, unchanged.
    const strict = await runVerification(box, plan, patch);
    assert.equal(strict.status, "failed");
    assert.equal(strict.baseline, undefined);
    assert.doesNotMatch(verificationMarkdown(strict), /Already failing/);
  });
});

test("runVerification with a baseline: a new failure still fails, and baseline-only failures do not count as reproduction", async () => {
  await withBox(FLAKY_MAIN, async (box) => {
    await boxRequest(box, "POST", "/write", { path: "tests/test_math.py", content: "# the new test\n" });
    const unfixed = await boxPatch(box);
    const plan = { setup: [], test: ["node tests/run.js"], lint: [] };
    const v = await runVerification(box, plan, unfixed, [], BASELINE);
    assert.equal(v.status, "failed");
    assert.deepEqual(v.baseline?.newFailures, ["tests/test_math.py::test_add"]);
    assert.match(verificationLogBlock(v), /1 new failure\(s\): tests\/test_math\.py::test_add/);
  });
  // A fix whose test passes either way: only the baseline failure shows with
  // the source reverted, so the test does not reproduce the bug.
  await withBox({ ...FLAKY_MAIN, "tests/run.js": RUNNER.replace('require("../math").add(2, 2) === 4', "true") }, async (box) => {
    await boxRequest(box, "POST", "/edit", { path: "math.js", old_string: "a - b", new_string: "a + b" });
    await boxRequest(box, "POST", "/write", { path: "tests/test_math.py", content: "# the new test\n" });
    const v = await runVerification(box, { setup: [], test: ["node tests/run.js"], lint: [] }, await boxPatch(box), [], BASELINE);
    assert.equal(v.status, "verified");
    assert.equal(v.regression, "not_reproduced");
  });
});
