import { test } from "node:test";
import assert from "node:assert/strict";
import { newCloudRunId, ownerPrefix, runPath, runLogChunk, runIsActive, type CloudRun } from "../cloud-run-state";

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
