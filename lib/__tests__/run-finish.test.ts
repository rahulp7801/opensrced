import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { finishRun } from "../run-finish";

const LOG = [
  "## Diagnosis", "The parser drops the exponent.", "",
  "## PR title", "fix: keep exponents", "",
  "## PR body", "Keeps the exponent when parsing numbers, so 1e3 stays 1000.", "",
  "```diff", "--- a/src/a.py", "+++ b/src/a.py", "@@ -1 +1 @@", "-x = 1", "+x = 2", "```", "",
].join("\n");

async function run(standIn: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-finish-"));
  const logPath = path.join(dir, "run.log");
  writeFileSync(logPath, LOG);
  try {
    // issueNumber 0 (a finding): no GitHub lookups.
    const preview = await finishRun({ repoFull: "o/r", issueNumber: 0, dispatchId: "d_x", dispatchDir: path.join(dir, "d_x"), logPath, exec: null, profile: null, issueLabels: [], privateOrg: false, standIn });
    return { preview, log: readFileSync(logPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("finishRun freezes a preview and never publishes", async () => {
  const { preview, log } = await run(false);
  assert.equal(preview?.title, "fix: keep exponents");
  assert.deepEqual(preview?.blockers, []);
  assert.match(preview!.body, /Not verified: the tool could not run code/);
  assert.match(log, /\[preview\] nothing has been published/);
});

test("a stand-in agent's preview carries a blocker, so it can never be published", async () => {
  const { preview, log } = await run(true);
  assert.match(preview!.blockers.join(" "), /scripted stand-in agent/);
  assert.match(log, /\[preview\] BLOCKED: this patch was produced by the scripted stand-in agent/);
});

test("finishRun returns null when there is no patch", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-finish-"));
  try {
    writeFileSync(path.join(dir, "run.log"), "## Diagnosis\nnothing to change\n");
    const preview = await finishRun({ repoFull: "o/r", issueNumber: 0, dispatchId: "d_y", dispatchDir: path.join(dir, "d_y"), logPath: path.join(dir, "run.log"), exec: null, profile: null, issueLabels: [], privateOrg: false });
    assert.equal(preview, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
