import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initBox, startExecBox, type ExecBox } from "../exec-box";
import { detectEnv, envRecipesOn, recipePlan, runSetup, setupPromptNotes } from "../exec-run";
import type { SetupPlan } from "../contrib-profile";
import { CI_SHIM, DEFAULT_TIMEOUTS } from "../env/recipe";
import type { Detection } from "../env/detect";

const detection = (over: Partial<Detection["recipe"]>): Detection => ({
  recipe: { repo: "o/r", source: "ci", runtimes: {}, services: [], env: {}, setup: [], test: [], lint: [], timeouts: { ...DEFAULT_TIMEOUTS }, ...over },
  hash: "h", notes: [], partial: false, unknownActions: [],
});

test("envRecipesOn reads OPENSRCER_ENV_RECIPES at call time; only '1' turns it on", () => {
  const before = process.env.OPENSRCER_ENV_RECIPES;
  try {
    for (const [value, on] of [["1", true], ["0", false], ["true", false], ["", false]] as const) {
      process.env.OPENSRCER_ENV_RECIPES = value;
      assert.equal(envRecipesOn(), on, value);
    }
    delete process.env.OPENSRCER_ENV_RECIPES;
    assert.equal(envRecipesOn(), false);
  } finally {
    if (before === undefined) delete process.env.OPENSRCER_ENV_RECIPES;
    else process.env.OPENSRCER_ENV_RECIPES = before;
  }
});

test("recipePlan: a recipe's setup lines become the setup plan; builtin and empty recipes do not", () => {
  const plan = recipePlan(detection({ setup: ["pip install -e ."], test: ["pytest"] }))!;
  assert.deepEqual(plan.commands.slice(0, 2), [CI_SHIM, "pip install -e ."]);
  assert.equal(plan.persistent, false);
  assert.match(plan.hint, /from the repository's ci recipe\. Its full test suite: `pytest`\./);
  assert.equal(recipePlan(detection({ source: "builtin", setup: ["x"] })), null);
  assert.equal(recipePlan(detection({ source: "agent" })), null);
});

test("detectEnv logs what it found, from a real checkout", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-detectenv-"));
  try {
    writeFileSync(path.join(dir, "go.mod"), "module x\n\ngo 1.22\n");
    const lines: string[] = [];
    const d = await detectEnv(dir, "acme/x", (l) => lines.push(l));
    assert.equal(d?.recipe.source, "lockfile");
    assert.match(lines[0], /^\[env\] recipe source=lockfile hash=[0-9a-f]{16} partial=false setup=1 test=1 runtimes=go@1\.22\n$/);
    assert.ok(lines.some((l) => /lockfile: go\.mod/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recipe setup lines actually run in the box (runSetup over recipePlan)", async () => {
  await withBox(async (box) => {
    const plan = recipePlan(detection({ env: { GREETING: "hi" }, setup: ['echo "PART=two" >> "$GITHUB_ENV"', 'echo "$GREETING-$PART-$CI" > setup-ran.txt'] }))!;
    const lines: string[] = [];
    const r = await runSetup(box, plan, null, (l) => lines.push(l));
    assert.equal(r.status, "ok", lines.join(""));
    const check = await runSetup(box, { commands: ["test \"$(cat setup-ran.txt)\" = hi-two-true"], hashFiles: [], persistent: false, hint: "" }, null, () => {});
    assert.equal(check.status, "ok", "the file the recipe's setup wrote has the shimmed CI values");
  });
});

async function withBox(fn: (box: ExecBox) => Promise<void>) {
  const work = mkdtempSync(path.join(tmpdir(), "opensrcer-setup-work-"));
  const repo = mkdtempSync(path.join(tmpdir(), "opensrcer-setup-repo-"));
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
  const sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  let box: ExecBox | undefined;
  try {
    box = await startExecBox("host", "d_setup", work);
    await initBox(box, repo, sha);
    await fn(box);
  } finally {
    await box?.stop();
    rmSync(work, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

test("runSetup: a persistent environment is installed once, then reused by hash", async () => {
  await withBox(async (box) => {
    const plan: SetupPlan = { commands: ["echo installing > ~/env/installed.txt"], hashFiles: [], persistent: true, hint: "use ~/env" };
    const lines: string[] = [];
    const first = await runSetup(box, plan, "abc123def456", (l) => lines.push(l));
    assert.equal(first.status, "ok");
    const second = await runSetup(box, plan, "abc123def456", (l) => lines.push(l));
    assert.equal(second.status, "cached");
    assert.ok(lines.some((l) => /^\[setup\] status=ok duration=/.test(l)));
    assert.match(setupPromptNotes(second), /already installed the environment; do not reinstall it\. use ~\/env/);
    // A different lockfile hash is a different environment.
    assert.equal((await runSetup(box, plan, "000000000000", () => {})).status, "ok");
  });
});

test("runSetup: failure is reported with its output and never throws", async () => {
  await withBox(async (box) => {
    const lines: string[] = [];
    const failed = await runSetup(box, { commands: ["echo broken-dependency >&2; exit 3"], hashFiles: [], persistent: false, hint: "h" }, null, (l) => lines.push(l));
    assert.equal(failed.status, "failed");
    assert.match(failed.tail, /broken-dependency/);
    assert.ok(lines.some((l) => /\[setup\] status=failed/.test(l)));
    assert.match(setupPromptNotes(failed), /setup FAILED[\s\S]*broken-dependency/);
    const none = await runSetup(box, null, null, () => {});
    assert.equal(none.status, "none");
    assert.match(setupPromptNotes(none), /No environment is pre-installed/);
  });
});
