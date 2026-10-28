import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { persist } from "../dispatch-store";
import { listDispatches } from "../dispatcher";
import { hiddenRunLocked, revealHiddenRun, runPhase, runRevealed, stripHiddenSummary, visibleRuns, RUN_PHASE_LABEL } from "../hidden-runs";

// Local mode: sidecars and markers under .dispatches/ (the hosted path uses
// the same functions with Blob paths; see cloud-publish.test.ts).
delete process.env.VERCEL;
delete process.env.OPENSRCER_EXECUTION;

const DIR = path.join(process.cwd(), ".dispatches");

function fixture(id: string, fields: Record<string, unknown>) {
  persist({
    id, auth0_user_id: "owner", repo_url: "https://github.com/o/r", mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: "awaiting_review",
    stats: { cost_usd: 0.4, has_diff: true, pr_title: "Fix the session cookie on redirects" }, pr_failure_reason: "blocked: edits src/flask/sessions.py",
    ...fields,
  });
  return () => {
    rmSync(path.join(DIR, id), { recursive: true, force: true });
    rmSync(path.join(DIR, `${id}.json`), { force: true });
  };
}

test("a hidden run is locked until its reveal marker exists; ordinary runs never are", async () => {
  const hidden = `d_test_hidden_${process.pid}`;
  const plain = `d_test_plain_${process.pid}`;
  const cleanup = [fixture(hidden, { hidden: true }), fixture(plain, {})];
  try {
    assert.equal(await hiddenRunLocked("owner", { id: hidden, hidden: true }), true);
    assert.equal(await hiddenRunLocked("owner", { id: plain }), false);
    assert.equal(await runRevealed("owner", hidden), false);
    await revealHiddenRun("owner", hidden);
    assert.equal(await runRevealed("owner", hidden), true);
    assert.equal(await hiddenRunLocked("owner", { id: hidden, hidden: true }), false);
  } finally { cleanup.forEach((c) => c()); }
});

test("the reveal marker refuses ids that are not run ids", async () => {
  await assert.rejects(revealHiddenRun("owner", "../../etc"), /Invalid run id/);
  assert.equal(await runRevealed("owner", "../../etc"), false);
});

test("the list keeps a locked hidden run's row but drops its PR title, has_diff and failure reason", async () => {
  const hidden = `d_test_list_hidden_${process.pid}`;
  const plain = `d_test_list_plain_${process.pid}`;
  const cleanup = [fixture(hidden, { hidden: true }), fixture(plain, {})];
  try {
    const rows = await visibleRuns("owner", listDispatches("owner", 50).filter((d) => d.id === hidden || d.id === plain));
    const h = rows.find((r) => r.id === hidden)!;
    const p = rows.find((r) => r.id === plain)!;
    assert.equal(h.status, "succeeded", "status and timing stay");
    assert.deepEqual((h as { stats?: unknown }).stats, { cost_usd: 0.4 });
    assert.equal((h as { pr_failure_reason?: string }).pr_failure_reason, undefined);
    assert.doesNotMatch(JSON.stringify(h), /session cookie|sessions\.py|has_diff/);
    assert.equal((p as { stats?: { pr_title?: string } }).stats?.pr_title, "Fix the session cookie on redirects", "ordinary runs are untouched");
    await revealHiddenRun("owner", hidden);
    const revealed = (await visibleRuns("owner", listDispatches("owner", 50).filter((d) => d.id === hidden)))[0] as { stats?: { pr_title?: string } };
    assert.equal(revealed.stats?.pr_title, "Fix the session cookie on redirects", "after the reveal the row is whole again");
  } finally { cleanup.forEach((c) => c()); }
});

test("stripHiddenSummary handles a row without stats", () => {
  assert.deepEqual(stripHiddenSummary({ stats: undefined, pr_failure_reason: undefined }), {});
});

test("progress phases come from fixed markers, never from log text", () => {
  const cases: Array<[string, string, keyof typeof RUN_PHASE_LABEL]> = [
    ["running", "Preparing isolated agent worker...\n[exec] mode=box (recipe)\n[exec] checkout abc\n", "setting_up"],
    ["running", "[agentic-dispatcher] bin: claude (stream-json)\n", "solving"],
    ["running", "[agentic-dispatcher] paid by: Claude plan\n\n[tool] edit_file src/flask/sessions.py\n", "solving"],
    ["running", "[tool] edit_file a.py\n\n[exec] final patch = git diff of the workspace (120 bytes)\n```diff\n+x\n```\n", "proving"],
    ["running", "[verify] re-running 1 test\n", "proving"],
    ["succeeded", "anything", "ready"],
    ["failed", "[tool] edit_file a.py", "failed"],
    ["killed", "", "failed"],
  ];
  for (const [status, log, phase] of cases) assert.equal(runPhase({ status }, log), phase, `${status}: ${log.slice(0, 30)}`);
  // The label is fixed text: nothing from the log can reach it.
  for (const label of Object.values(RUN_PHASE_LABEL)) assert.doesNotMatch(label, /sessions|\.py|diff/);
});
