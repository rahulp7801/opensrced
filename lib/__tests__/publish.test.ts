import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { persist, read } from "../dispatch-store";
import type { DispatchRecord } from "../dispatch-store";
import { buildPreview, readPreview, writePreview } from "../pr-preview";
import { checkPublishable, CONFIRMATION, PublishError, publishDispatch } from "../publish";
import type { Verification } from "../verify";

const DIR = path.join(process.cwd(), ".dispatches");
const DIFF = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n";
const verified: Verification = {
  status: "verified", reason: "declared tests pass", regression: "reproduced", plan: { setup: [], test: ["pytest t.py"], lint: [] },
  evidence: [{ kind: "test", command: "pytest t.py", exit_code: 0, timed_out: false, duration_ms: 2000, output_tail: "1 passed" }],
};

async function fixture(id: string, record: Partial<DispatchRecord>, blockers: string[] = []) {
  mkdirSync(path.join(DIR, id), { recursive: true });
  persist({
    id, auth0_user_id: "owner", repo_url: "https://github.com/o/r", mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: "awaiting_review", ...record,
  });
  const preview = buildPreview({
    title: "[Bugfix] fix x", body: "Fixes #7\n\n- [ ] AI assistance was used.", diff: DIFF, profile: null, verification: verified,
    executed: true, model: "claude-sonnet-5", provider: "Anthropic", privateOrg: false, blockers,
  });
  await writePreview(path.join(DIR, id), preview, DIFF);
  return () => {
    rmSync(path.join(DIR, id), { recursive: true, force: true });
    rmSync(path.join(DIR, `${id}.json`), { force: true });
  };
}

test("preview: body carries Tests run and the AI note; commit carries the trailer", async () => {
  const id = `d_test_preview_${process.pid}`;
  const cleanup = await fixture(id, {});
  try {
    const stored = await readPreview(path.join(DIR, id));
    assert.ok(stored);
    assert.equal(stored.diff, DIFF, "the stored patch is exactly what was frozen");
    assert.match(stored.preview.body, /- \[x\] AI assistance was used\./);
    assert.match(stored.preview.body, /### Tests run\n\n- `pytest t\.py` — passed/);
    assert.match(stored.preview.body, /### AI assistance[\s\S]*claude-sonnet-5 \(Anthropic\)/);
    assert.equal(stored.preview.commit_message, "[Bugfix] fix x\n\nAssisted-by: claude-sonnet-5 via opensrcer");
    assert.deepEqual(stored.preview.files, ["a.py"]);
    assert.equal(stored.preview.blockers.length, 0);
  } finally { cleanup(); }
  assert.equal(await readPreview(path.join(DIR, "d_missing_preview")), null);
});

test("publish gate: confirmation, ownership, dry runs, state and blockers", async () => {
  const id = `d_test_gate_${process.pid}`;
  const cleanup = await fixture(id, {});
  const dry = `d_test_dry_${process.pid}`;
  const cleanupDry = await fixture(dry, { dry_run: true });
  const blocked = `d_test_blocked_${process.pid}`;
  const cleanupBlocked = await fixture(blocked, { pr_status: "awaiting_review" }, ["this project does not accept AI-generated contributions"]);
  try {
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: undefined }), (e: PublishError) => e.status === 400 && e.message.includes(CONFIRMATION));
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: "yes" }), (e: PublishError) => e.status === 400, "only a literal true confirms");
    await assert.rejects(checkPublishable({ id, viewerId: "someone-else", confirmed: true }), (e: PublishError) => e.status === 404);
    await assert.rejects(checkPublishable({ id: "../../etc", viewerId: "owner", confirmed: true }), (e: PublishError) => e.status === 404);
    await assert.rejects(checkPublishable({ id: dry, viewerId: "owner", confirmed: true }), /preview-only/);
    await assert.rejects(checkPublishable({ id: blocked, viewerId: "owner", confirmed: true }), /blocked: this project does not accept/);
    const ok = await checkPublishable({ id, viewerId: "owner", confirmed: true });
    assert.equal(ok.stored.diff, DIFF);
    // No GitHub identity: refused before any network call or state change.
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: true, token: null, author: null }), (e: PublishError) => e.status === 401);
    assert.equal(read(id)?.pr_status, "awaiting_review");
  } finally { cleanup(); cleanupDry(); cleanupBlocked(); }
});

test("publish gate: an already published or running run cannot be published again", async () => {
  const id = `d_test_done_${process.pid}`;
  const cleanup = await fixture(id, { pr_status: "opened" });
  try {
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: true }), /already published/);
  } finally { cleanup(); }
  const running = `d_test_running_${process.pid}`;
  const cleanupRunning = await fixture(running, { status: "running", pr_status: "none" });
  try {
    await assert.rejects(checkPublishable({ id: running, viewerId: "owner", confirmed: true }), /no reviewed preview/);
  } finally { cleanupRunning(); }
});
