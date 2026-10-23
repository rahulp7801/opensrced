import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  aiDisclosureMarkdown, aiTrailer, commentDisclosure, disclosureEnabled, HIDING_PHRASES, tickAiCheckboxes,
} from "../disclosure";
import type { Verification } from "../verify";

const verified: Verification = {
  status: "verified", reason: "ok", regression: "reproduced", plan: { setup: [], test: ["pytest a"], lint: [] },
  evidence: [{ kind: "test", command: "pytest a", exit_code: 0, timed_out: false, duration_ms: 1000, output_tail: "" }],
};

test("disclosure names the tool, the human, the model and exactly what was verified", () => {
  const md = aiDisclosureMarkdown({ model: "claude-sonnet-5", provider: "Anthropic", verification: verified, executed: true });
  assert.match(md, /^### AI assistance/);
  assert.match(md, /opensrcer/);
  assert.match(md, /reviewed the diff and the test evidence/);
  assert.match(md, /claude-sonnet-5 \(Anthropic\)/);
  assert.match(md, /new test fails without the fix/);
  const none = aiDisclosureMarkdown({ model: "m", provider: "p", verification: null, executed: false });
  assert.match(none, /Not verified: the tool could not run code/);
  const failed = aiDisclosureMarkdown({ model: "m", provider: "p", verification: { ...verified, status: "failed", reason: "a declared test failed" }, executed: true });
  assert.match(failed, /Verification FAILED \(a declared test failed\)/);
});

test("disclosure can only be switched off for private-org runs", () => {
  const saved = process.env.OPENSRCER_AI_DISCLOSURE;
  try {
    process.env.OPENSRCER_AI_DISCLOSURE = "0";
    assert.equal(disclosureEnabled(false), true, "public contributions always disclose");
    assert.equal(disclosureEnabled(true), false);
    delete process.env.OPENSRCER_AI_DISCLOSURE;
    assert.equal(disclosureEnabled(true), true);
  } finally {
    if (saved === undefined) delete process.env.OPENSRCER_AI_DISCLOSURE; else process.env.OPENSRCER_AI_DISCLOSURE = saved;
  }
});

test("template checkboxes, trailers and comment notes", () => {
  const body = "- [ ] I used vLLM's skill.\n- [ ] AI assistance was used during the creation of this PR.\n- [ ] **Design Fit:** ...";
  assert.equal(tickAiCheckboxes(body), "- [ ] I used vLLM's skill.\n- [x] AI assistance was used during the creation of this PR.\n- [ ] **Design Fit:** ...");
  assert.equal(tickAiCheckboxes("no boxes"), "no boxes");
  assert.equal(aiTrailer({ aiTrailer: "Co-authored-by" }, "claude-sonnet-5"), "Co-authored-by: claude-sonnet-5 via opensrcer");
  assert.equal(aiTrailer(null, "m"), "Assisted-by: m via opensrcer");
  assert.match(commentDisclosure("m"), /AI assistance/);
});

// A lint-style guard: no prompt or code path may tell a model to hide AI
// use. components/tour/* is owned by the demo session and only describes
// features ("no AI needed"), so it is out of scope.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__" || p.replace(/\\/g, "/").includes("components/tour")) continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

test("no source file instructs a model to hide AI assistance", () => {
  const offenders: string[] = [];
  for (const root of ["app", "lib", "components", "scripts"]) {
    for (const file of sourceFiles(path.join(process.cwd(), root))) {
      if (file.endsWith(`disclosure.ts`)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of HIDING_PHRASES) if (re.test(text)) offenders.push(`${path.relative(process.cwd(), file)}: ${re}`);
    }
  }
  assert.deepEqual(offenders, []);
});
