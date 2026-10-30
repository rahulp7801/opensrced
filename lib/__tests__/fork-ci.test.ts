import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { persist } from "../dispatch-store";
import {
  actionsStatus, classifyForkCi, closeForkPr, enableActions, ensureFork, failingStepExcerpt, ForkCiError, forkCiSummary,
  ForkNotReadyError, ForkPrError, loadForkCi, openForkPr, pollRunForkCi, runForkCi, startRunForkCi, syncFork, SyncForkError,
  watchForkCi, NO_RUN_GRACE_MS, RUNNER_WAIT_MS, FORK_CI_TIMEOUT_MS, type ForkCiWatch, type ForkJob,
} from "../fork-ci";

// Local mode: records in .dispatches/, fork-CI results in .dispatches/fork-ci/.
delete process.env.OPENSRCER_EXECUTION;
delete process.env.VERCEL;

const TOKEN = "test-user-token";
const FORK = "me/app";
const SHA = "a".repeat(40);
const BRANCH = "opensrcer/issue-7-abc";
const noSleep = async () => {};

type Call = { method: string; path: string; auth: string | null; body: unknown; redirect?: RequestRedirect };
type Handler = (call: Call) => unknown;

/** GitHub stand-in: routes are "METHOD /path" (query ignored) to a JSON value
 *  or a Response. Unrouted requests answer 404. Every call is recorded. */
function fakeGitHub(t: TestContext, routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? "GET", path: url.host === "api.github.com" ? url.pathname + url.search : url.href,
      auth: new Headers(init.headers).get("Authorization"), body: init.body ? JSON.parse(String(init.body)) : undefined, redirect: init.redirect,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${url.host === "api.github.com" ? url.pathname : url.href}`];
    if (!handler) return new Response("{}", { status: 404 });
    const value = handler(call);
    return value instanceof Response ? value : Response.json(value);
  });
  return calls;
}

const status = (code: number) => () => new Response("{}", { status: code });

// ── ensureFork / syncFork ──────────────────────────────────────────────

test("ensureFork returns the fork GitHub names and waits until it is readable", async (t) => {
  let reads = 0;
  const calls = fakeGitHub(t, {
    "POST /repos/acme/app/forks": () => ({ full_name: "me/app-renamed", default_branch: "main" }),
    "GET /repos/me/app-renamed/branches/main": () => (++reads < 3 ? new Response("{}", { status: 404 }) : { name: "main" }),
  });
  let slept = 0;
  assert.equal(await ensureFork(TOKEN, "acme/app", async () => { slept++; }), "me/app-renamed");
  assert.equal(slept, 2);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[0].body, {});
});

test("ensureFork refuses bad names, the user's own repo, and a fork that never becomes ready", async (t) => {
  await assert.rejects(ensureFork(TOKEN, "not a repo", noSleep), (e) => e instanceof ForkCiError && e.status === 400);
  fakeGitHub(t, {
    "POST /repos/me/mine/forks": () => ({ full_name: "me/mine", default_branch: "main" }),
    "POST /repos/acme/slow/forks": () => ({ full_name: "me/slow", default_branch: "main" }),
    "GET /repos/me/slow/branches/main": status(409),
  });
  await assert.rejects(ensureFork(TOKEN, "me/mine", noSleep), (e) => e instanceof ForkCiError && e.status === 409);
  await assert.rejects(ensureFork(TOKEN, "acme/slow", noSleep), ForkNotReadyError);
});

test("ensureFork passes on GitHub errors other than not-ready", async (t) => {
  fakeGitHub(t, { "POST /repos/acme/app/forks": status(403) });
  await assert.rejects(ensureFork(TOKEN, "acme/app", noSleep), (e: Error & { status?: number }) => e.name !== "ForkNotReadyError" && e.status === 403);
});

test("syncFork merges upstream into the named branch; a diverged branch is SyncForkError", async (t) => {
  const calls = fakeGitHub(t, {
    "POST /repos/me/app/merge-upstream": () => ({ merge_type: "fast-forward" }),
    "POST /repos/me/diverged/merge-upstream": status(409),
  });
  assert.equal(await syncFork(TOKEN, FORK, "main"), "fast-forward");
  assert.deepEqual(calls[0].body, { branch: "main" });
  await assert.rejects(syncFork(TOKEN, "me/diverged", "main"), SyncForkError);
});

// ── Actions ────────────────────────────────────────────────────────────

const workflowsDir = () => [{ name: "ci.yml", type: "file" }, { name: "README.md", type: "file" }, { name: "lint.yaml", type: "file" }];

test("actionsStatus: files present but no workflow registered is the fork gate (S4)", async (t) => {
  fakeGitHub(t, {
    "GET /repos/me/app/actions/permissions": () => ({ enabled: true, allowed_actions: "all" }),
    "GET /repos/me/app/contents/.github/workflows": workflowsDir,
    "GET /repos/me/app/actions/workflows": () => ({ total_count: 0, workflows: [] }),
  });
  const result = await actionsStatus(TOKEN, FORK);
  assert.equal(result.needsUserAction, true);
  assert.equal(result.workflows, 2);
  assert.equal(result.url, "https://github.com/me/app/actions");
});

test("actionsStatus: registered workflows run; no workflow files means nothing to run", async (t) => {
  fakeGitHub(t, {
    "GET /repos/me/app/actions/permissions": () => ({ enabled: true }),
    "GET /repos/me/app/contents/.github/workflows": workflowsDir,
    "GET /repos/me/app/actions/workflows": () => ({ total_count: 2, workflows: [{ state: "active" }, { state: "disabled_manually" }] }),
    "GET /repos/me/bare/actions/permissions": () => ({ enabled: true }),
  });
  assert.deepEqual(await actionsStatus(TOKEN, FORK), { workflows: 2, needsUserAction: false, url: "https://github.com/me/app/actions" });
  assert.deepEqual(await actionsStatus(TOKEN, "me/bare"), { workflows: 0, needsUserAction: false, url: "https://github.com/me/bare/actions" });
});

test("actionsStatus: 403/404 on the settings and Actions turned off need the user", async (t) => {
  fakeGitHub(t, {
    "GET /repos/me/denied/actions/permissions": status(403),
    "GET /repos/me/off/actions/permissions": () => ({ enabled: false }),
    "GET /repos/me/off/contents/.github/workflows": workflowsDir,
    "GET /repos/me/broken/actions/permissions": status(500),
  });
  const denied = await actionsStatus(TOKEN, "me/denied");
  assert.equal(denied.needsUserAction, true);
  assert.equal(denied.url, "https://github.com/me/denied/actions");
  assert.equal((await actionsStatus(TOKEN, "me/off")).needsUserAction, true);
  await assert.rejects(actionsStatus(TOKEN, "me/broken"), (e: Error & { status?: number }) => e.status === 500);
});

test("enableActions PUTs the permission and re-reads; a refusal needs the user", async (t) => {
  const calls = fakeGitHub(t, {
    "PUT /repos/me/app/actions/permissions": () => new Response(null, { status: 204 }),
    "GET /repos/me/app/actions/permissions": () => ({ enabled: true }),
    "PUT /repos/me/nope/actions/permissions": status(403),
  });
  assert.equal((await enableActions(TOKEN, FORK)).needsUserAction, false);
  assert.deepEqual(calls[0], { method: "PUT", path: "/repos/me/app/actions/permissions", auth: `Bearer ${TOKEN}`, body: { enabled: true }, redirect: "error" });
  const refused = await enableActions(TOKEN, "me/nope");
  assert.deepEqual([refused.needsUserAction, refused.url], [true, "https://github.com/me/nope/actions"]);
});

// ── PR inside the fork ─────────────────────────────────────────────────

test("openForkPr opens a draft inside the fork: base is its default branch, head the fix branch", async (t) => {
  const calls = fakeGitHub(t, {
    "GET /repos/me/app": () => ({ default_branch: "develop" }),
    "POST /repos/me/app/pulls": () => ({ number: 3, html_url: "https://github.com/me/app/pull/3" }),
  });
  assert.deepEqual(await openForkPr(TOKEN, FORK, BRANCH, "Fix the thing"), { number: 3, url: "https://github.com/me/app/pull/3", base: "develop" });
  const body = calls[1].body as Record<string, unknown>;
  assert.deepEqual([body.head, body.base, body.draft, body.title], [BRANCH, "develop", true, "Fix the thing"]);
});

test("openForkPr reuses an open PR for the branch, and fails by name when there is none", async (t) => {
  let existing: unknown[] = [{ number: 5, html_url: "https://github.com/me/app/pull/5" }];
  const calls = fakeGitHub(t, {
    "GET /repos/me/app": () => ({ default_branch: "main" }),
    "POST /repos/me/app/pulls": status(422),
    "GET /repos/me/app/pulls": () => existing,
  });
  assert.equal((await openForkPr(TOKEN, FORK, BRANCH, "t")).number, 5);
  assert.match(calls[2].path, /head=me%3Aopensrcer%2Fissue-7-abc/);
  existing = [];
  await assert.rejects(openForkPr(TOKEN, FORK, BRANCH, "t"), ForkPrError);
  await assert.rejects(openForkPr(TOKEN, FORK, "../evil", "t"), (e) => e instanceof ForkCiError && e.status === 400);
});

test("closeForkPr PATCHes the PR closed and validates the number", async (t) => {
  const calls = fakeGitHub(t, { "PATCH /repos/me/app/pulls/3": () => ({}) });
  await closeForkPr(TOKEN, FORK, 3);
  assert.deepEqual([calls[0].method, calls[0].body], ["PATCH", { state: "closed" }]);
  await assert.rejects(closeForkPr(TOKEN, FORK, 0), ForkCiError);
});

// ── Watching ───────────────────────────────────────────────────────────

const LOG = [
  "\uFEFF2026-10-27T10:00:00.0000000Z ##[group]Run actions/checkout@v4",
  "2026-10-27T10:00:01.0000000Z checked out",
  "2026-10-27T10:00:02.0000000Z ##[group]Run pytest",
  "2026-10-27T10:00:03.0000000Z FAILED tests/test_x.py::test_y",
  "2026-10-27T10:00:04.0000000Z ##[error]Process completed with exit code 1.",
  "2026-10-27T10:00:05.0000000Z Post job cleanup.",
].join("\r\n");

test("failingStepExcerpt keeps the failing step through its error, without timestamps", () => {
  assert.equal(failingStepExcerpt(LOG), "##[group]Run pytest\nFAILED tests/test_x.py::test_y\n##[error]Process completed with exit code 1.");
  assert.equal(failingStepExcerpt(LOG, 2), "FAILED tests/test_x.py::test_y\n##[error]Process completed with exit code 1.");
  assert.equal(failingStepExcerpt("a\nb\nc", 2), "b\nc");
  assert.equal(failingStepExcerpt(""), "");
});

test("watchForkCi lists runs and jobs for the SHA and downloads failed logs without the token", async (t) => {
  const calls = fakeGitHub(t, {
    "GET /repos/me/app/actions/runs": () => ({ workflow_runs: [{ id: 11, name: "CI", event: "pull_request", status: "completed", conclusion: "failure", html_url: "https://github.com/me/app/actions/runs/11" }] }),
    "GET /repos/me/app/actions/runs/11/jobs": () => ({ jobs: [
      { id: 21, run_id: 11, name: "test", status: "completed", conclusion: "failure", html_url: "https://github.com/me/app/actions/runs/11/job/21", labels: ["ubuntu-latest"], created_at: "2026-10-27T10:00:00Z", steps: [{ name: "Set up", conclusion: "success" }, { name: "pytest", conclusion: "failure" }] },
      { id: 22, run_id: 11, name: "lint", status: "completed", conclusion: "success", html_url: "https://github.com/me/app/actions/runs/11/job/22", labels: [], created_at: "2026-10-27T10:00:00Z" },
    ] }),
    "GET /repos/me/app/actions/jobs/21/logs": () => new Response(null, { status: 302, headers: { location: "https://results.example/log?sig=x" } }),
    "GET https://results.example/log?sig=x": () => new Response(LOG),
  });
  const watch = await watchForkCi(TOKEN, FORK, SHA);
  assert.match(calls[0].path, new RegExp(`head_sha=${SHA}`));
  assert.deepEqual(watch.jobs.map((j) => [j.name, j.state, j.failed_step]), [["test", "failure", "pytest"], ["lint", "success", null]]);
  assert.equal(watch.failures.length, 1);
  assert.equal(watch.failures[0].job, "CI / test");
  assert.match(watch.failures[0].log, /FAILED tests\/test_x.py/);
  const logCalls = calls.filter((c) => c.path.includes("logs") || c.path.startsWith("https://results"));
  assert.equal(logCalls[0].redirect, "manual");
  assert.equal(logCalls[1].auth, null, "the signed log URL never gets the GitHub token");
  await assert.rejects(watchForkCi(TOKEN, FORK, "nope"), ForkCiError);
});

test("watchForkCi skips log downloads while jobs are still running", async (t) => {
  const calls = fakeGitHub(t, {
    "GET /repos/me/app/actions/runs": () => ({ workflow_runs: [{ id: 11, name: "CI", event: "push", status: "in_progress", conclusion: null, html_url: "u" }] }),
    "GET /repos/me/app/actions/runs/11/jobs": () => ({ jobs: [
      { id: 21, run_id: 11, name: "a", status: "completed", conclusion: "failure", html_url: "u1", created_at: "2026-10-27T10:00:00Z" },
      { id: 22, run_id: 11, name: "b", status: "in_progress", conclusion: null, html_url: "u2", created_at: "2026-10-27T10:00:00Z" },
    ] }),
  });
  assert.deepEqual((await watchForkCi(TOKEN, FORK, SHA)).failures, []);
  assert.equal(calls.some((c) => c.path.includes("/logs")), false);
});

// ── Classification ─────────────────────────────────────────────────────

const T0 = Date.parse("2026-10-27T10:00:00Z");
function job(over: Partial<ForkJob> = {}): ForkJob {
  return { id: 1, run_id: 1, name: "test", workflow: "CI", url: "u", status: "completed", conclusion: "success", state: "success", labels: [], created_at: new Date(T0).toISOString(), failed_step: null, ...over };
}
const RUN: ForkCiWatch["runs"][number] = { id: 1, name: "CI", event: "pull_request", status: "completed", conclusion: "success", url: "https://github.com/me/app/actions/runs/1" };
const failedJob = job({ conclusion: "failure", state: "failure" });
const queued = (labels: string[]) => job({ status: "queued", conclusion: null, state: "pending", labels });
const watchOf = (jobs: ForkJob[], logs: string[] = [], runs = jobs.length ? [RUN] : []): ForkCiWatch =>
  ({ runs, jobs, failures: logs.map((log) => ({ job: "CI / test", step: "pytest", url: "u", log })) });

const CASES: Array<[string, ForkCiWatch, number, number, string]> = [
  ["all jobs pass", watchOf([job(), job({ conclusion: "skipped", state: "neutral" })]), 3, 60_000, "passed"],
  ["a job fails", watchOf([job(), failedJob], ["##[error]AssertionError"]), 3, 60_000, "failed"],
  ["a job fails while another still runs", watchOf([failedJob, job({ status: "in_progress", conclusion: null, state: "pending" })]), 3, 60_000, "pending"],
  ["a job fails on an empty secret", watchOf([failedJob], ["##[group]Run codecov\nenv:\n  CODECOV_TOKEN: \n##[error]Token required"]), 3, 60_000, "needs_secrets"],
  ["an action's input is missing", watchOf([failedJob], ["##[error]Input required and not supplied: token"]), 3, 60_000, "needs_secrets"],
  ["the failure log could not be read", watchOf([failedJob]), 3, 60_000, "failed"],
  ["every job skipped", watchOf([job({ conclusion: "skipped", state: "neutral" })]), 3, 60_000, "skipped_on_forks"],
  ["queued on self-hosted past the wait", watchOf([queued(["self-hosted", "linux"])]), 3, RUNNER_WAIT_MS, "self_hosted"],
  ["queued on a GPU label past the wait", watchOf([queued(["linux-gpu-a10"])]), 3, RUNNER_WAIT_MS, "self_hosted"],
  ["queued on self-hosted, still waiting", watchOf([queued(["self-hosted"])]), 3, RUNNER_WAIT_MS - 1, "pending"],
  ["queued on a hosted runner past the wait", watchOf([queued(["ubuntu-latest"])]), 3, RUNNER_WAIT_MS, "pending"],
  ["still running past the deadline", watchOf([job({ status: "in_progress", conclusion: null, state: "pending" })]), 3, FORK_CI_TIMEOUT_MS, "timeout"],
  ["no workflow files", watchOf([]), 0, 0, "no_workflows"],
  ["no run yet", watchOf([]), 3, NO_RUN_GRACE_MS - 1, "pending"],
  ["no run after the grace period", watchOf([]), 3, NO_RUN_GRACE_MS, "no_workflows"],
  ["a run without jobs yet", watchOf([], [], [{ ...RUN, status: "queued", conclusion: null }]), 3, NO_RUN_GRACE_MS, "pending"],
  ["an invalid workflow (no jobs)", watchOf([], [], [{ ...RUN, conclusion: "startup_failure" }]), 3, 60_000, "failed"],
];

for (const [name, watch, workflows, elapsed, expected] of CASES) {
  test(`classifyForkCi: ${name} -> ${expected}`, () => {
    assert.equal(classifyForkCi(watch, { workflows, startedAt: T0, now: T0 + elapsed }), expected);
  });
}

test("forkCiSummary claims a pass only for a real pass", () => {
  const passing = watchOf([job(), job({ conclusion: "skipped", state: "neutral" })]);
  const claim = /Passed the project's own CI in your fork/;
  assert.match(forkCiSummary("passed", passing, FORK)[0], /\(1 job; 1 skipped on forks\)/);
  for (const cls of ["failed", "needs_secrets", "skipped_on_forks", "self_hosted", "timeout", "no_workflows", "pending", "needs_user_action"] as const) {
    assert.doesNotMatch(forkCiSummary(cls, passing, FORK).join("\n"), claim, cls);
  }
  assert.match(forkCiSummary("needs_user_action", null, FORK)[0], /https:\/\/github\.com\/me\/app\/actions/);
  assert.deepEqual(forkCiSummary("failed", watchOf([failedJob], ["x"]), FORK).slice(1), ["- CI / test (step: pytest): u"]);
});

// ── Orchestrator ───────────────────────────────────────────────────────

/** A fork whose workflows run: one CI run that passes on the second poll. */
function happyFork(t: TestContext, polls = { n: 0 }) {
  return fakeGitHub(t, {
    "POST /repos/acme/app/forks": () => ({ full_name: FORK, default_branch: "main" }),
    "GET /repos/me/app/branches/main": () => ({ name: "main" }),
    "GET /repos/me/app/actions/permissions": () => ({ enabled: true }),
    "GET /repos/me/app/contents/.github/workflows": workflowsDir,
    "GET /repos/me/app/actions/workflows": () => ({ total_count: 1, workflows: [{ state: "active" }] }),
    "GET /repos/me/app": () => ({ default_branch: "main" }),
    "POST /repos/me/app/merge-upstream": status(409),
    "POST /repos/me/app/pulls": () => ({ number: 3, html_url: "https://github.com/me/app/pull/3" }),
    "PATCH /repos/me/app/pulls/3": () => ({}),
    "GET /repos/me/app/actions/runs": () => ({ workflow_runs: [{ id: 11, name: "CI", event: "pull_request", status: "completed", conclusion: "success", html_url: "https://github.com/me/app/actions/runs/11" }] }),
    "GET /repos/me/app/actions/runs/11/jobs": () => ({ jobs: [{ id: 21, run_id: 11, name: "test", html_url: "u", created_at: new Date().toISOString(),
      ...(++polls.n < 2 ? { status: "in_progress", conclusion: null } : { status: "completed", conclusion: "success" }) }] }),
    "GET /repos/acme/app/pulls/12": () => ({ title: "Fix the thing", head: { sha: SHA, ref: BRANCH, repo: { full_name: FORK } } }),
  });
}

test("runForkCi: fork, PR inside the fork, poll to a pass, close the fork PR", async (t) => {
  const calls = happyFork(t);
  const result = await runForkCi({ token: TOKEN, upstream: "acme/app", branch: BRANCH, sha: SHA, title: "Fix the thing" }, { sleep: noSleep });
  assert.equal(result.status, "passed");
  assert.equal(result.summary[0], "Passed the project's own CI in your fork (1 job).");
  assert.deepEqual(result.fork_pr, { number: 3, url: "https://github.com/me/app/pull/3", base: "main", closed: true });
  assert.equal(result.notes.length, 1, "a refused sync is a note, not a failure");
  assert.ok(calls.some((c) => c.method === "PATCH"));
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
});

test("runForkCi stops before the PR when the fork gate is up", async (t) => {
  const calls = fakeGitHub(t, {
    "POST /repos/acme/app/forks": () => ({ full_name: FORK, default_branch: "main" }),
    "GET /repos/me/app/branches/main": () => ({ name: "main" }),
    "GET /repos/me/app/actions/permissions": () => ({ enabled: true }),
    "PUT /repos/me/app/actions/permissions": () => new Response(null, { status: 204 }),
    "GET /repos/me/app/contents/.github/workflows": workflowsDir,
    "GET /repos/me/app/actions/workflows": () => ({ total_count: 0, workflows: [] }),
  });
  const result = await runForkCi({ token: TOKEN, upstream: "acme/app", branch: BRANCH, sha: SHA, title: "t" }, { sleep: noSleep });
  assert.equal(result.status, "needs_user_action");
  assert.equal(result.actions_url, "https://github.com/me/app/actions");
  assert.equal(result.fork_pr, undefined);
  assert.equal(calls.some((c) => c.path.endsWith("/pulls")), false);
});

// ── Per-run glue (local mode) ──────────────────────────────────────────

const DIR = path.join(process.cwd(), ".dispatches");
const OWNER = `forkci-owner-${process.pid}`;

function seedRun(id: string, prUrl?: string) {
  persist({ id, auth0_user_id: OWNER, repo_url: "https://github.com/acme/app", mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: prUrl ? "opened" : "awaiting_review", ...(prUrl ? { pr_url: prUrl } : {}) });
  return () => {
    rmSync(path.join(DIR, `${id}.json`), { force: true });
    rmSync(path.join(DIR, "fork-ci", `${id}.json`), { force: true });
  };
}

test("startRunForkCi/pollRunForkCi: the run's PR head, stored next to the run, polled to a result", async (t) => {
  const id = `d_forkci_ok_${process.pid}`;
  const cleanup = seedRun(id, "https://github.com/acme/app/pull/12");
  try {
    happyFork(t);
    assert.equal(await pollRunForkCi(OWNER, id, TOKEN), null);
    const started = await startRunForkCi(OWNER, id, TOKEN, noSleep);
    assert.deepEqual([started.status, started.branch, started.sha, started.fork], ["running", BRANCH, SHA, FORK]);
    assert.equal((await loadForkCi(OWNER, id))?.status, "running");
    // Same commit again: no second PR.
    assert.equal((await startRunForkCi(OWNER, id, TOKEN, noSleep)).started_at, started.started_at);
    assert.equal((await pollRunForkCi(OWNER, id, TOKEN))?.status, "running");
    assert.equal((await pollRunForkCi(OWNER, id, null))?.status, "running", "no token: stored state, no GitHub call");
    const done = await pollRunForkCi(OWNER, id, TOKEN);
    assert.equal(done?.status, "passed");
    assert.equal((await loadForkCi(OWNER, id))?.status, "passed");
  } finally { cleanup(); }
});

test("startRunForkCi refuses other users' runs, unpublished runs and same-repo branches", async (t) => {
  const unpublished = `d_forkci_unpub_${process.pid}`;
  const sameRepo = `d_forkci_same_${process.pid}`;
  const cleanups = [seedRun(unpublished), seedRun(sameRepo, "https://github.com/acme/app/pull/13")];
  try {
    fakeGitHub(t, { "GET /repos/acme/app/pulls/13": () => ({ title: "t", head: { sha: SHA, ref: "fix", repo: { full_name: "acme/app" } } }) });
    const refused = (status: number) => (e: unknown) => e instanceof ForkCiError && e.status === status;
    await assert.rejects(startRunForkCi("someone-else", unpublished, TOKEN, noSleep), refused(404));
    await assert.rejects(startRunForkCi(OWNER, "../etc", TOKEN, noSleep), refused(404));
    await assert.rejects(startRunForkCi(OWNER, unpublished, TOKEN, noSleep), refused(409));
    await assert.rejects(startRunForkCi(OWNER, sameRepo, TOKEN, noSleep), refused(409));
    await assert.rejects(pollRunForkCi("someone-else", sameRepo, TOKEN), refused(404));
  } finally { cleanups.forEach((c) => c()); }
});
