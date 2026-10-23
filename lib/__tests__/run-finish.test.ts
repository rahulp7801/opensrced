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

test("fewer covered variants than listed is a warning, not a blocker", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-finish-"));
  try {
    const log = `${LOG}\n## Cases\n\`\`\`cases\ncase: exponent with sign -> test_signed\ncase: exponent without digits -> not covered\n\`\`\`\n`;
    writeFileSync(path.join(dir, "run.log"), log);
    const preview = await finishRun({ repoFull: "o/r", issueNumber: 0, dispatchId: "d_c", dispatchDir: path.join(dir, "d_c"), logPath: path.join(dir, "run.log"), exec: null, profile: null, issueLabels: [], privateOrg: false });
    assert.deepEqual(preview!.cases, [{ variant: "exponent with sign", test: "test_signed" }, { variant: "exponent without digits", test: null }]);
    assert.match(preview!.warnings.join(" "), /listed 2 reported variant\(s\) but covered only 1 with a test; not covered: exponent without digits/);
    assert.deepEqual(preview!.blockers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a ChatGPT-plan run discloses OpenAI and Codex, not Anthropic", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-finish-"));
  try {
    writeFileSync(path.join(dir, "run.log"), LOG);
    const preview = await finishRun({ repoFull: "o/r", issueNumber: 0, dispatchId: "d_o", dispatchDir: path.join(dir, "d_o"), logPath: path.join(dir, "run.log"), exec: null, profile: null, issueLabels: [], privateOrg: false, model: "Codex (ChatGPT plan)", provider: "OpenAI" });
    assert.match(preview!.body, /Model: Codex \(ChatGPT plan\) \(OpenAI\), driven through the Codex CLI/);
    assert.doesNotMatch(preview!.body, /Anthropic|Claude Code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a follow-up run's own PR is not a competing PR; a new run's is", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-finish-"));
  const realFetch = globalThis.fetch;
  let calls = 0;
  // The issue timeline shows one open PR: the user's own, being followed up.
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify([{ event: "cross-referenced", source: { issue: { number: 12, state: "open", pull_request: {}, html_url: "https://github.com/o/r/pull/12" } } }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    writeFileSync(path.join(dir, "run.log"), LOG);
    const base = { repoFull: "o/r", issueNumber: 7, dispatchId: "d_f", logPath: path.join(dir, "run.log"), exec: null, profile: null, issueLabels: [], privateOrg: false };
    const followup = await finishRun({ ...base, dispatchDir: path.join(dir, "d_f"), followup: true });
    assert.deepEqual(followup!.blockers, []);
    assert.equal(calls, 0, "no competing-PR lookup for a follow-up");
    const fresh = await finishRun({ ...base, dispatchDir: path.join(dir, "d_g") });
    assert.match(fresh!.blockers.join(" "), /already targets this issue/);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
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
