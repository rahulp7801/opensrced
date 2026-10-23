import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commitArgs, refusedPaths } from "../agentic-pr";
import { buildPreview } from "../pr-preview";

function profile(dco: boolean, aiTrailer: string | null) {
  return { repo: "o/r", dco, cla: null, prTemplate: null, agentInstructions: null, aiPolicy: { stance: "unknown" as const, source: null, excerpt: null }, aiTrailer, notes: [], discussFirst: null, sources: [] };
}

test("DCO repositories get a real Signed-off-by for the user, plus the AI trailer", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-commit-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(path.join(dir, "a.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "a.txt"]);
    const preview = buildPreview({ title: "[Bugfix] fix x", body: "Fixes #1", diff: "", profile: profile(true, "Assisted-by"), verification: null,
      executed: false, model: "claude-sonnet-5", provider: "Anthropic", privateOrg: false });
    // Commit with an isolated config so no host hook or template interferes.
    const hooks = mkdtempSync(path.join(tmpdir(), "opensrcer-nohooks-"));
    execFileSync("git", ["-c", `core.hooksPath=${hooks}`, ...commitArgs(dir, { name: "alice", email: "42+alice@users.noreply.github.com" }, preview)]);
    const message = execFileSync("git", ["-C", dir, "log", "-1", "--format=%B"], { encoding: "utf8" });
    assert.match(message, /^\[Bugfix\] fix x\n/);
    assert.match(message, /^Assisted-by: claude-sonnet-5 via opensrcer$/m);
    assert.match(message, /^Signed-off-by: alice <42\+alice@users\.noreply\.github\.com>$/m);
    assert.equal(execFileSync("git", ["-C", dir, "log", "-1", "--format=%an <%ae>"], { encoding: "utf8" }).trim(), "alice <42+alice@users.noreply.github.com>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no sign-off without a DCO; the repository's own trailer key wins", () => {
  const preview = buildPreview({ title: "fix: y", body: "b", diff: "", profile: profile(false, "Co-authored-by"), verification: null,
    executed: false, model: "m", provider: "p", privateOrg: false });
  const args = commitArgs("/w", { name: "n", email: "e" }, preview);
  assert.ok(!args.includes("--signoff"));
  assert.equal(args.at(-1), "fix: y\n\nCo-authored-by: m via opensrcer");
});

test("refusedPaths: workflow files anywhere, compiled code only for pytorch", () => {
  const diff = (p: string) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`;
  assert.deepEqual(refusedPaths(diff(".github/workflows/ci.yml"), "o/r"), [".github/workflows/ci.yml"]);
  assert.deepEqual(refusedPaths(diff("aten/src/x.cpp"), "pytorch/pytorch"), ["aten/src/x.cpp"]);
  assert.deepEqual(refusedPaths(diff("csrc/x.cu"), "vllm-project/vllm"), []);
  assert.deepEqual(refusedPaths(diff("src/a.py"), "pytorch/pytorch"), []);
});
