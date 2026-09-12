import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudWorkerJobJson } from "../cloud-worker-job";
import type { StartAgenticOpts } from "../agentic-dispatcher";
import type { CloudRun } from "../cloud-run-state";

test("hosted worker jobs use an explicit input allowlist", () => {
  const run = {
    id: "c_1767225600000_abcdef123456",
    auth0_user_id: "auth0|alice",
    repo_url: "https://github.com/acme/app",
    issue_number: 42,
    mode: "agentic",
    dry_run: false,
    started_at: "2026-01-01T00:00:00.000Z",
    status: "running",
    log_path: "",
    sandbox_name: "c-1767225600000-abcdef123456",
    expires_at: 1767229200000,
    log: "Preparing isolated agent worker...\n",
    log_size: 35,
    tests: "not_run",
  } satisfies CloudRun;
  const opts = {
    dryRun: false,
    notes: "Fix the regression",
    token: "fake-user-token",
    orgCtx: { auth0UserId: "auth0|alice", githubOrg: "acme" },
    anthropicKey: "fake-anthropic-key",
    geminiKey: "fake-gemini-key",
    maxSpendUsd: 1,
    auth0UserId: "auth0|alice",
    serverOnlyFutureField: "must-not-enter-the-worker",
  } as StartAgenticOpts & { serverOnlyFutureField: string };

  const job = JSON.parse(cloudWorkerJobJson(run, "runs/alice/run.json", opts));

  assert.deepEqual(job.opts, {
    dryRun: false,
    notes: "Fix the regression",
    token: "fake-user-token",
    installationToken: true,
    anthropicKey: "fake-anthropic-key",
    geminiKey: "fake-gemini-key",
    maxSpendUsd: 1,
    auth0UserId: "auth0|alice",
  });
  assert.equal("orgCtx" in job.opts, false);
  assert.equal("serverOnlyFutureField" in job.opts, false);
});
