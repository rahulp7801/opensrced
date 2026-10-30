import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { persist } from "../dispatch-store";
import { buildPreview, writePreview } from "../pr-preview";
import { revealHiddenRun } from "../hidden-runs";
import { lessonStore } from "../lesson/store";
import { loadRunChange } from "../run-change";
import type { ServerChange } from "../explain";

delete process.env.VERCEL;
delete process.env.OPENSRCER_EXECUTION;

const DIR = path.join(process.cwd(), ".dispatches");
const DIFF = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n";

async function fixture(id: string, fields: Record<string, unknown>, preview = true) {
  mkdirSync(path.join(DIR, id), { recursive: true });
  persist({ id, auth0_user_id: "owner", repo_url: "https://github.com/o/r", mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: "awaiting_review", ...fields });
  if (preview) {
    await writePreview(path.join(DIR, id), buildPreview({ title: "Fix x <diff>", body: "Fixes #7", diff: DIFF, profile: null, verification: null,
      executed: false, model: "m", provider: "Anthropic", privateOrg: false }), DIFF);
  }
  return () => { rmSync(path.join(DIR, id), { recursive: true, force: true }); rmSync(path.join(DIR, `${id}.json`), { force: true }); };
}

test("run mode loads the caller's own stored change, capped and fenced", async () => {
  const id = `d_test_change_${process.pid}`;
  const cleanup = await fixture(id, {});
  try {
    const loaded = await loadRunChange("owner", { runId: id }) as ServerChange;
    assert.equal(loaded.runId, id);
    assert.equal(loaded.change.repo, "o/r");
    assert.equal(loaded.change.context.diff, DIFF.trim());
    assert.match(loaded.change.context.description, /PR text:\nFixes #7/);
    assert.match(loaded.change.context.verification, /not verified/);
    assert.equal(loaded.change.title, "Fix x &lt;diff>", "our fence tags are defused in stored text too");
  } finally { cleanup(); }
});

test("someone else's run, a missing run, no session, no preview: refused", async () => {
  const id = `d_test_change_refused_${process.pid}`;
  const bare = `d_test_change_bare_${process.pid}`;
  const cleanup = [await fixture(id, {}), await fixture(bare, {}, false)];
  try {
    assert.equal((await loadRunChange("mallory", { runId: id }) as Response).status, 404);
    assert.equal((await loadRunChange("owner", { runId: "d_missing" }) as Response).status, 404);
    assert.equal((await loadRunChange(null, { runId: id }) as Response).status, 401);
    assert.equal((await loadRunChange("owner", { runId: bare }) as Response).status, 409);
  } finally { cleanup.forEach((c) => c()); }
});

test("a lesson's hidden run is refused until the reveal, by run id or lesson id", async () => {
  const id = `d_test_change_hidden_${process.pid}`;
  const cleanup = await fixture(id, { hidden: true });
  try {
    const lesson = await lessonStore().create({ owner: "owner", repo_url: "https://github.com/o/r", issue_number: 7, run_id: id, mode: "short", path: "A", stage: "kickoff", answer_key: "pending" });
    assert.equal((await loadRunChange("owner", { runId: id }) as Response).status, 403);
    assert.equal((await loadRunChange("owner", { lessonId: lesson.id }) as Response).status, 403);
    assert.equal((await loadRunChange("mallory", { lessonId: lesson.id }) as Response).status, 404, "someone else's lesson");
    await revealHiddenRun("owner", id);
    assert.equal(((await loadRunChange("owner", { lessonId: lesson.id })) as ServerChange).runId, id);
  } finally { cleanup(); }
});
