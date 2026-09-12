import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudRunSummary, effectiveCloudRunState, newCloudRunId, ownerPrefix, runPath, runSummaryPath, runLogChunk, runIsActive, staleCloudRunIds, validCloudRun, validCloudRunSummary, type CloudRun } from "../cloud-run-state";

test("run storage paths are scoped to authenticated owners and reject traversal", () => {
  const id = newCloudRunId();
  assert.notEqual(runPath("alice", id), runPath("bob", id));
  assert.ok(runPath("alice", id).startsWith(ownerPrefix("alice")));
  assert.notEqual(runSummaryPath("alice", id), runSummaryPath("bob", id));
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

test("expired full and compact run records expose a terminal failure", () => {
  const run = { status: "running", expires_at: 100, pr_status: "pending" } as CloudRun;
  assert.deepEqual(effectiveCloudRunState(run, 101), {
    ...run,
    status: "failed",
    pr_status: "failed",
    pr_failure_reason: "Worker time limit reached or its result could not be saved.",
  });
  assert.equal(effectiveCloudRunState({ ...run, status: "succeeded", pr_status: "opened" }, 101).status, "succeeded");
  assert.equal(effectiveCloudRunState(run, 99).status, "running");
});

test("cloud history retention selects only the owner's oldest canonical records", () => {
  const ids = Array.from({ length: 103 }, (_, index) => `c_${1767225600000 + index}_${index.toString(16).padStart(12, "0")}`);
  const alicePaths = ids.map((id) => runPath("alice", id));
  const stale = staleCloudRunIds("alice", [
    ...alicePaths.reverse(),
    runPath("bob", ids[0]),
    `${ownerPrefix("alice")}not-a-run.json`,
  ]);
  assert.deepEqual(stale, ids.slice(0, 3).reverse());
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
  } satisfies CloudRun;
  assert.equal(validCloudRun(run, "alice", id), true);
  const summary = cloudRunSummary(run);
  assert.equal(validCloudRunSummary(summary, "alice", id), true);
  assert.equal("log" in summary, false);
  assert.equal("log_size" in summary, false);
  assert.equal(validCloudRunSummary({ ...summary, log: "private output" }, "alice", id), false);
  for (const changed of [
    { auth0_user_id: "bob" },
    { sandbox_name: "another-worker" },
    { status: "complete" },
    { log_path: "/tmp/private.log" },
    { repo_url: "acme/app" },
    { repo_url: "https://example.com/acme/app" },
    { log_size: 1 },
    { log: "x".repeat(250_001), log_size: 250_001 },
    { issue_number: -1 },
    { pr_url: "javascript:alert(1)" },
    { pr_failure_reason: "x".repeat(501) },
    { expires_at: Number.NaN },
  ]) assert.equal(validCloudRun({ ...run, ...changed }, "alice", id), false);
});
