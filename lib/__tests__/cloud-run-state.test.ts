import { test } from "node:test";
import assert from "node:assert/strict";
import { newCloudRunId, ownerPrefix, runPath, runLogChunk, runIsActive, validCloudRun, type CloudRun } from "../cloud-run-state";

test("run storage paths are scoped to authenticated owners and reject traversal", () => {
  const id = newCloudRunId();
  assert.notEqual(runPath("alice", id), runPath("bob", id));
  assert.ok(runPath("alice", id).startsWith(ownerPrefix("alice")));
  for (const value of ["../alice", "c_1_x", "/etc/passwd"]) assert.throws(() => runPath("bob", value));
  assert.throws(() => ownerPrefix(""));
});

test("expired and completed jobs free capacity; PR work keeps it occupied", () => {
  const run = { status: "running", expires_at: Date.now() + 10000 } as CloudRun;
  assert.equal(runIsActive(run), true);
  assert.equal(runIsActive({ ...run, expires_at: 0 }), false);
  assert.equal(runIsActive({ ...run, status: "succeeded" }), false);
  assert.equal(runIsActive({ ...run, status: "succeeded", pr_status: "pending" }), true);
});

test("incremental cloud logs use byte offsets and reset after truncation", () => {
  const run = { log: "hello\nworld", log_size: 111 } as CloudRun;
  assert.equal(runLogChunk(run, 106).log, "world");
  assert.equal(runLogChunk(run, 0).log_reset, true);
  assert.equal(runLogChunk(run, 111).log, "");
});

test("hosted run records are bound to their owner, id, sandbox, and bounded log shape", () => {
  const id = "c_1767225600000_abcdef123456";
  const run = {
    id,
    auth0_user_id: "alice",
    repo_url: "https://github.com/acme/app",
    mode: "agentic",
    dry_run: true,
    started_at: "2026-01-01T00:00:00.000Z",
    status: "running",
    log_path: "",
    sandbox_name: "c-1767225600000-abcdef123456",
    expires_at: Date.now() + 60_000,
    log: "working\n",
    log_size: 8,
  };
  assert.equal(validCloudRun(run, "alice", id), true);
  for (const changed of [
    { auth0_user_id: "bob" },
    { sandbox_name: "another-worker" },
    { status: "complete" },
    { log_path: "/tmp/private.log" },
    { log_size: 1 },
    { log: "x".repeat(250_001), log_size: 250_001 },
    { issue_number: -1 },
    { pr_url: "javascript:alert(1)" },
    { pr_failure_reason: "x".repeat(501) },
    { expires_at: Number.NaN },
  ]) assert.equal(validCloudRun({ ...run, ...changed }, "alice", id), false);
});
