import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boxPatch, boxRequest, initBox, startExecBox, type ExecBox } from "../exec-box";
import {
  failBeforeScript, isTestPath, parseCases, parseVerificationPlan, runVerification, testOutcome, verificationMarkdown, type Verification,
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
  for (const [f, c] of Object.entries(files)) writeFileSync(path.join(dir, f), c);
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
