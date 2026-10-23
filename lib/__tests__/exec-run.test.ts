import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initBox, startExecBox, type ExecBox } from "../exec-box";
import { runSetup, setupPromptNotes } from "../exec-run";
import type { SetupPlan } from "../contrib-profile";

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
