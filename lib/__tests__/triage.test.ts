import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTriage, triageIssue, triagePrompt } from "../triage";

test("parseTriage: proceeds on fixable bugs, refuses what the box cannot verify", () => {
  assert.deepEqual(parseTriage('{"category": "bug", "reason": "parser drops exponent"}'), { proceed: true, category: "bug", reason: "parser drops exponent" });
  assert.equal(parseTriage('Sure! {"category":"needs_gpu","reason":"CUDA graph capture"}').proceed, false);
  assert.equal(parseTriage('{"category":"needs_compiled_code","reason":"kernel"}').proceed, false);
  assert.equal(parseTriage('{"category":"question","reason":"how do I"}').proceed, false);
  assert.equal(parseTriage('{"category":"large_feature","reason":"new backend"}').proceed, false);
});

test("parseTriage: anything unparseable or unknown proceeds (triage never blocks by accident)", () => {
  assert.deepEqual(parseTriage("I think this is a bug."), { proceed: true, category: "unclear", reason: "triage answer could not be parsed" });
  assert.equal(parseTriage('{"category":"refuse_everything","reason":"x"}').category, "unclear");
  assert.equal(parseTriage('{"category":"refuse_everything","reason":"x"}').proceed, true);
});

test("triagePrompt fences nothing new and names the box's limits", () => {
  const p = triagePrompt("o/r", "<issue-report untrusted=\"true\">x</issue-report>");
  assert.match(p, /no GPU/);
  assert.match(p, /<issue-report untrusted="true">x<\/issue-report>/);
});

test("triageIssue is skipped when OPENSRCER_TRIAGE=0", async () => {
  const saved = process.env.OPENSRCER_TRIAGE;
  process.env.OPENSRCER_TRIAGE = "0";
  try {
    assert.equal(await triageIssue({ repo: "o/r", issueFormatted: "x", workDir: "unused" }), null);
  } finally {
    if (saved === undefined) delete process.env.OPENSRCER_TRIAGE; else process.env.OPENSRCER_TRIAGE = saved;
  }
});
