// Fork CI as the final check (PLAN §5.8). The fix's branch already lives on
// the user's fork; this runs the project's OWN GitHub Actions there, in the
// user's account and under their Actions quota:
//
//   ensureFork -> actions check -> syncFork -> draft PR inside the fork
//   (fork:default <- fork:branch, so `pull_request` workflows fire) -> watch
//   the workflow runs for the head SHA -> classify -> close the fork PR.
//
// Everything here is a REST call made with the user's GitHub token from a
// server route; nothing runs project code, so the token never enters a VM
// that does. We never edit workflow files (agentic-pr `refusedPaths`).
//
// Spike S4 (2026-10-27, read-only on existing forks): every fork reported
// `actions/permissions` enabled=true, yet listed 0 workflows and 0 runs while
// holding 4-31 workflow files. GitHub's "Workflows aren't being run on this
// forked repository" gate is not in the permissions API; "files present but
// no workflow registered" is the signal, and only the user can lift it.
//
// The glue at the bottom stores one record per run next to the run record
// (.dispatches/fork-ci/<id>.json locally, an owner-scoped Blob when hosted)
// for POST/GET /api/dispatches/<id>/fork-ci.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cloudExecution, runForkCiPath } from "./cloud-run-state";
import { read as readDispatch } from "./dispatch-store";
import { githubApi, githubResponse, GitHubApiError } from "./github-api";
import { parseGitHubPullUrl } from "./github-pull-url";
import { checkState, type CheckResult } from "./pr-lifecycle";

// ── Errors ─────────────────────────────────────────────────────────────

/** A fork-CI refusal or failure with an HTTP status and a user-safe message. */
export class ForkCiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ForkCiError";
  }
}

/** The fork was requested but GitHub had not finished creating it in time. */
export class ForkNotReadyError extends ForkCiError {
  constructor(fork: string) {
    super(504, `GitHub is still creating your fork ${fork}. Try again in a minute.`);
    this.name = "ForkNotReadyError";
  }
}

/** merge-upstream refused: the fork's branch has diverged from the project. */
export class SyncForkError extends ForkCiError {
  constructor(fork: string, branch: string) {
    super(409, `Could not bring ${fork}'s ${branch} up to date with the project (it has its own commits).`);
    this.name = "SyncForkError";
  }
}

/** The draft PR inside the fork could not be opened or found. */
export class ForkPrError extends ForkCiError {
  constructor(message: string) {
    super(502, message);
    this.name = "ForkPrError";
  }
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^(?!.*\.\.)(?!\/)[\w./-]{1,200}(?<!\/)$/;
const SHA_RE = /^[0-9a-f]{40}$/;

function assertRepo(repo: string): void {
  if (!REPO_RE.test(repo)) throw new ForkCiError(400, "invalid repository name");
}

type Sleep = (ms: number) => Promise<unknown>;

// ── Fork ───────────────────────────────────────────────────────────────

const FORK_POLL_MS = 2_000;
const FORK_POLLS = 30;

/** The user's fork of `upstream` ("owner/name"), created if missing. GitHub
 *  answers POST /forks with the existing fork when there is one (under
 *  whatever name it has), and creates a new one asynchronously: wait until
 *  its default branch is readable before anyone pushes to it. */
export async function ensureFork(token: string, upstream: string, sleep: Sleep = delay): Promise<string> {
  assertRepo(upstream);
  const fork = await githubApi<{ full_name: string; default_branch: string }>(`/repos/${upstream}/forks`, token, {});
  if (!REPO_RE.test(fork.full_name)) throw new ForkCiError(502, "GitHub returned an invalid fork name.");
  if (fork.full_name.toLowerCase() === upstream.toLowerCase()) throw new ForkCiError(409, "This is your own repository; there is no fork to run CI in.");
  for (let attempt = 0; ; attempt++) {
    try {
      await githubApi(`/repos/${fork.full_name}/branches/${encodeURIComponent(fork.default_branch)}`, token);
      return fork.full_name;
    } catch (error) {
      // 404 / 409 ("Git Repository is empty") while the copy is in progress.
      if (!(error instanceof GitHubApiError) || (error.status !== 404 && error.status !== 409)) throw error;
    }
    if (attempt + 1 >= FORK_POLLS) throw new ForkNotReadyError(fork.full_name);
    await sleep(FORK_POLL_MS);
  }
}

/** Fast-forward the fork's `branch` to the project's (POST merge-upstream).
 *  Returns GitHub's merge type ("fast-forward", "merge" or "none"). */
export async function syncFork(token: string, fork: string, branch: string): Promise<string> {
  assertRepo(fork);
  try {
    const result = await githubApi<{ merge_type?: string }>(`/repos/${fork}/merge-upstream`, token, { branch });
    return result.merge_type ?? "none";
  } catch (error) {
    if (error instanceof GitHubApiError && (error.status === 409 || error.status === 422)) throw new SyncForkError(fork, branch);
    throw error;
  }
}

// ── Actions on the fork ────────────────────────────────────────────────

export type ActionsStatus = {
  /** Workflow files on the fork's default branch. 0 means no CI to run. */
  workflows: number;
  /** The user has to click once in GitHub before workflows run. */
  needsUserAction: boolean;
  /** Where that click happens: the fork's Actions tab. */
  url: string;
  reason?: string;
};

export function actionsUrl(fork: string): string {
  return `https://github.com/${fork}/actions`;
}

function blocked(fork: string, reason: string, workflows = 0): ActionsStatus {
  return { workflows, needsUserAction: true, url: actionsUrl(fork), reason };
}

/** Whether the fork's workflows will run. Read-only. A 403/404 (the token
 *  cannot read Actions settings) is "needs the user", never an error. */
export async function actionsStatus(token: string, fork: string): Promise<ActionsStatus> {
  assertRepo(fork);
  const deniedIsUserAction = async <T>(request: Promise<T>): Promise<T | null> => {
    try { return await request; }
    catch (error) {
      if (error instanceof GitHubApiError && (error.status === 403 || error.status === 404)) return null;
      throw error;
    }
  };
  const permissions = await deniedIsUserAction(githubApi<{ enabled: boolean }>(`/repos/${fork}/actions/permissions`, token));
  if (!permissions) return blocked(fork, "This sign-in cannot read your fork's Actions settings.");
  const files = await workflowFiles(token, fork);
  if (!permissions.enabled) return blocked(fork, "GitHub Actions is turned off on your fork.", files);
  if (files === 0) return { workflows: 0, needsUserAction: false, url: actionsUrl(fork) };
  const registered = await deniedIsUserAction(githubApi<{ total_count: number; workflows: Array<{ state: string }> }>(`/repos/${fork}/actions/workflows?per_page=100`, token));
  if (!registered) return blocked(fork, "This sign-in cannot read your fork's workflows.", files);
  // S4: a fork's workflows stay unregistered (or "disabled_fork") until the
  // owner allows them once on the Actions tab.
  if (registered.total_count === 0 || registered.workflows.every((w) => w.state === "disabled_fork")) {
    return blocked(fork, "GitHub pauses workflows on a new fork until you allow them once.", files);
  }
  return { workflows: files, needsUserAction: false, url: actionsUrl(fork) };
}

/** Workflow files (.yml/.yaml) under .github/workflows on the default branch. */
async function workflowFiles(token: string, fork: string): Promise<number> {
  try {
    const entries = await githubApi<Array<{ name: string; type: string }>>(`/repos/${fork}/contents/.github/workflows`, token);
    return Array.isArray(entries) ? entries.filter((e) => e.type === "file" && /\.ya?ml$/i.test(e.name)).length : 0;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return 0;
    throw error;
  }
}

/** Turn Actions on for the fork (PUT actions/permissions), then re-read the
 *  status: the fork gate above can remain even when this succeeds. 403/404
 *  (missing scope or admin rights) is "needs the user". */
export async function enableActions(token: string, fork: string): Promise<ActionsStatus> {
  assertRepo(fork);
  try {
    await githubResponse(`/repos/${fork}/actions/permissions`, token, { enabled: true }, undefined, undefined, { method: "PUT" });
  } catch (error) {
    if (error instanceof GitHubApiError && (error.status === 403 || error.status === 404)) return blocked(fork, "This sign-in cannot change your fork's Actions settings.");
    throw error;
  }
  return actionsStatus(token, fork);
}

// ── The PR inside the fork ─────────────────────────────────────────────

export type ForkPr = { number: number; url: string; base: string };

const FORK_PR_BODY = "opensrcer opened this draft inside your fork only, so the project's own CI runs on your change. " +
  "It is not sent to the project and is closed when the CI result is in.";

/** A draft PR inside the fork (base = fork default branch, head = `branch`).
 *  An already-open one for the same branch is reused. */
export async function openForkPr(token: string, fork: string, branch: string, title: string): Promise<ForkPr> {
  assertRepo(fork);
  if (!BRANCH_RE.test(branch)) throw new ForkCiError(400, "invalid branch name");
  const repo = await githubApi<{ default_branch: string }>(`/repos/${fork}`, token);
  if (repo.default_branch === branch) throw new ForkCiError(409, "The fix is on the fork's default branch; push it to its own branch first.");
  try {
    const pr = await githubApi<{ number: number; html_url: string }>(`/repos/${fork}/pulls`, token, {
      title: title.slice(0, 250) || `opensrcer: ${branch}`, head: branch, base: repo.default_branch, draft: true, body: FORK_PR_BODY,
    });
    return { number: pr.number, url: pr.html_url, base: repo.default_branch };
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
  }
  // 422: a PR for this head already exists, or the branch is missing.
  const owner = fork.split("/")[0];
  const open = await githubApi<Array<{ number: number; html_url: string }>>(
    `/repos/${fork}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(repo.default_branch)}`, token);
  if (!open[0]) throw new ForkPrError(`Could not open a PR inside ${fork} for ${branch}. Is the branch still there?`);
  return { number: open[0].number, url: open[0].html_url, base: repo.default_branch };
}

/** Close the fork PR (its runs keep their results). */
export async function closeForkPr(token: string, fork: string, number: number): Promise<void> {
  assertRepo(fork);
  if (!Number.isSafeInteger(number) || number < 1) throw new ForkCiError(400, "invalid PR number");
  await githubResponse(`/repos/${fork}/pulls/${number}`, token, { state: "closed" }, undefined, undefined, { method: "PATCH" });
}

// ── Watching the runs ──────────────────────────────────────────────────

export type ForkJob = {
  id: number; run_id: number; name: string; workflow: string; url: string;
  status: string; conclusion: string | null; state: CheckResult["state"];
  labels: string[]; created_at: string; failed_step: string | null;
};

export type ForkFailure = { job: string; step: string | null; url: string; log: string };

export type ForkCiWatch = {
  runs: Array<{ id: number; name: string; event: string; status: string; conclusion: string | null; url: string }>;
  jobs: ForkJob[];
  /** Filled only once every job finished: excerpts of the failed jobs' logs. */
  failures: ForkFailure[];
};

const LOG_LINES = 200;
const LOG_BYTES = 2_000_000;
const MAX_FAILURE_LOGS = 3;

type GhRun = { id: number; name: string | null; event: string; status: string; conclusion: string | null; html_url: string };
type GhJob = {
  id: number; run_id: number; name: string; status: string; conclusion: string | null; html_url: string;
  labels?: string[]; created_at: string; steps?: Array<{ name: string; conclusion: string | null }>;
};

/** The workflow runs for `sha` on the fork, their jobs and, when all jobs
 *  are done, the failing step's log tail for each failed job. Read-only. */
export async function watchForkCi(token: string, fork: string, sha: string): Promise<ForkCiWatch> {
  assertRepo(fork);
  if (!SHA_RE.test(sha)) throw new ForkCiError(400, "invalid commit SHA");
  const listed = await githubApi<{ workflow_runs: GhRun[] }>(`/repos/${fork}/actions/runs?head_sha=${sha}&per_page=100`, token);
  const runs = listed.workflow_runs.map((r) => ({ id: r.id, name: r.name ?? "workflow", event: r.event, status: r.status, conclusion: r.conclusion, url: r.html_url }));
  const jobs = (await Promise.all(runs.map(async (run) => {
    const page = await githubApi<{ jobs: GhJob[] }>(`/repos/${fork}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, token);
    return page.jobs.map((j): ForkJob => ({
      id: j.id, run_id: j.run_id, name: j.name, workflow: run.name, url: j.html_url, status: j.status, conclusion: j.conclusion,
      // pr-lifecycle's reading of a check run: an Actions job is one.
      state: checkState(j.status, j.conclusion), labels: j.labels ?? [], created_at: j.created_at,
      failed_step: j.steps?.find((s) => s.conclusion === "failure")?.name ?? null,
    }));
  }))).flat();
  const failures: ForkFailure[] = [];
  // Not pr-lifecycle's ciVerdict: it says "failed" while other jobs still run.
  if (jobs.length && jobs.every((j) => j.state !== "pending")) {
    for (const job of jobs.filter((j) => j.state === "failure").slice(0, MAX_FAILURE_LOGS)) {
      const log = await jobLog(token, fork, job.id).catch(() => "");
      failures.push({ job: `${job.workflow} / ${job.name}`, step: job.failed_step, url: job.url, log: failingStepExcerpt(log) });
    }
  }
  return { runs, jobs, failures };
}

/** A job's raw log. The API answers with a redirect to signed storage: follow
 *  it WITHOUT the token (the URL carries its own credential). Keeps the tail. */
async function jobLog(token: string, fork: string, jobId: number): Promise<string> {
  const first = await githubResponse(`/repos/${fork}/actions/jobs/${jobId}/logs`, token, undefined, "application/vnd.github+json", undefined, { redirect: "manual" });
  const location = first.headers.get("location");
  if (first.ok || !location) return tailText(first);
  const target = new URL(location);
  if (target.protocol !== "https:" || target.username || target.password) throw new ForkCiError(502, "GitHub returned an invalid log location.");
  const response = await fetch(target.href, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new ForkCiError(502, `Could not download the job log (${response.status}).`);
  return tailText(response);
}

/** The last LOG_BYTES of a response body, read as a stream. */
async function tailText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value);
      size += chunk.value.byteLength;
      while (chunks.length > 1 && size - chunks[0].byteLength >= LOG_BYTES) size -= chunks.shift()!.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

/** The failing step's last LOG_LINES lines: from the last `##[group]Run`
 *  header before the last `##[error]` line, through that error. Timestamps
 *  are stripped. Without an error marker, the log's tail. Exported for tests. */
export function failingStepExcerpt(log: string, max = LOG_LINES): string {
  const lines = log.replace(/\r/g, "").split("\n").map((l) => l.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
  const error = lines.findLastIndex((l) => l.startsWith("##[error]"));
  const end = error >= 0 ? error + 1 : lines.length;
  const start = error >= 0 ? Math.max(0, lines.slice(0, end).findLastIndex((l) => l.startsWith("##[group]Run "))) : 0;
  return lines.slice(Math.max(start, end - max), end).join("\n").trimEnd();
}

// ── Classification (§5.8 step 7) ───────────────────────────────────────

export type ForkCiClass = "passed" | "failed" | "skipped_on_forks" | "needs_secrets" | "self_hosted" | "timeout" | "no_workflows";

export const FORK_CI_TIMEOUT_MS = 60 * 60_000;
/** No run for the commit this long after the PR opened: nothing triggers on it. */
export const NO_RUN_GRACE_MS = 5 * 60_000;
/** A job waiting this long for a self-hosted or GPU runner will not get one. */
export const RUNNER_WAIT_MS = 10 * 60_000;

const RUNNER_LABEL = /self-hosted|gpu|cuda/i;
// ponytail: a log heuristic. A missing secret prints as an empty env value
// ("  CODECOV_TOKEN: ") in the step header, or as an action's missing input.
// Reading the workflow YAML for `secrets.*` is the deterministic upgrade.
const MISSING_SECRET = /secrets\.[A-Za-z_]|Input required and not supplied|^\s+[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|_KEY):\s*$/m;

/** The verdict for the commit, or "pending" while it is still running. */
export function classifyForkCi(watch: ForkCiWatch, opts: { workflows: number; startedAt: number; now?: number; timeoutMs?: number }): ForkCiClass | "pending" {
  const now = opts.now ?? Date.now();
  const elapsed = now - opts.startedAt;
  if (opts.workflows === 0) return "no_workflows";
  if (watch.jobs.length === 0) {
    if (watch.runs.length === 0 && elapsed >= NO_RUN_GRACE_MS) return "no_workflows";
    // Finished without a job: an invalid workflow ("startup_failure") or a skip.
    if (watch.runs.length && watch.runs.every((r) => r.status === "completed")) {
      return watch.runs.some((r) => checkState(r.status, r.conclusion) === "failure") ? "failed" : "skipped_on_forks";
    }
    return elapsed >= (opts.timeoutMs ?? FORK_CI_TIMEOUT_MS) ? "timeout" : "pending";
  }
  if (watch.jobs.some((j) => j.state === "pending")) {
    const stuck = watch.jobs.some((j) => j.status !== "in_progress" && j.state === "pending" &&
      j.labels.some((l) => RUNNER_LABEL.test(l)) && now - Date.parse(j.created_at) >= RUNNER_WAIT_MS);
    if (stuck) return "self_hosted";
    return elapsed >= (opts.timeoutMs ?? FORK_CI_TIMEOUT_MS) ? "timeout" : "pending";
  }
  const failed = watch.jobs.filter((j) => j.state === "failure");
  if (failed.length) {
    const logs = watch.failures.map((f) => f.log);
    return logs.length === Math.min(failed.length, MAX_FAILURE_LOGS) && logs.every((l) => MISSING_SECRET.test(l)) ? "needs_secrets" : "failed";
  }
  // Every job was skipped (`if: github.repository == ...` and the like).
  return watch.jobs.some((j) => j.conclusion === "success") ? "passed" : "skipped_on_forks";
}

/** Lines for the PR body and the run page. "Passed the project's own CI in
 *  your fork" appears only for a real pass. */
export function forkCiSummary(cls: ForkCiClass | "pending" | "needs_user_action", watch: ForkCiWatch | null, fork: string): string[] {
  const jobs = watch?.jobs ?? [];
  const passed = jobs.filter((j) => j.conclusion === "success").length;
  const skipped = jobs.filter((j) => j.conclusion === "skipped").length;
  const head = {
    passed: `Passed the project's own CI in your fork (${passed} job${passed === 1 ? "" : "s"}${skipped ? `; ${skipped} skipped on forks` : ""}).`,
    failed: "The project's own CI failed in your fork.",
    needs_secrets: "The project's CI needs secrets that forks do not get, so it could not run fully in your fork.",
    skipped_on_forks: "The project's CI skips its jobs on forks, so it did not test this change.",
    self_hosted: "The project's CI needs its own runners (self-hosted or GPU), so it cannot run in your fork.",
    timeout: `The project's CI in your fork did not finish within ${FORK_CI_TIMEOUT_MS / 60_000} minutes.`,
    no_workflows: "No CI workflow ran in your fork for this change.",
    pending: "The project's CI is running in your fork.",
    needs_user_action: `Workflows are paused on your fork until you allow them once: ${actionsUrl(fork)}`,
  }[cls];
  const lines = [head];
  for (const f of watch?.failures ?? []) lines.push(`- ${f.job}${f.step ? ` (step: ${f.step})` : ""}: ${f.url}`);
  if (cls !== "failed") for (const r of watch?.runs ?? []) lines.push(`- ${r.name}: ${r.conclusion ?? r.status} (${r.url})`);
  return lines;
}

// ── Orchestration ──────────────────────────────────────────────────────

export type ForkCiStatus = ForkCiClass | "running" | "needs_user_action";

/** The stored, typed result of one fork-CI check. */
export type ForkCiRecord = {
  version: 1;
  upstream: string; fork: string; branch: string; sha: string;
  status: ForkCiStatus;
  workflows: number;
  actions_url: string;
  reason?: string;
  fork_pr?: ForkPr & { closed?: boolean };
  started_at: string; updated_at: string;
  runs: ForkCiWatch["runs"];
  failures: ForkFailure[];
  summary: string[];
  /** Non-fatal steps that did not work out (sync refused, close failed). */
  notes: string[];
};

export type ForkCiInput = { token: string; upstream: string; branch: string; sha: string; title: string };

/** Steps 1-5: fork, Actions, sync, the PR inside the fork. Stops at
 *  "needs_user_action" before opening the PR: `pull_request` only fires for
 *  a PR opened while workflows are allowed. */
export async function startForkCi(input: ForkCiInput, sleep: Sleep = delay): Promise<ForkCiRecord> {
  if (!BRANCH_RE.test(input.branch)) throw new ForkCiError(400, "invalid branch name");
  if (!SHA_RE.test(input.sha)) throw new ForkCiError(400, "invalid commit SHA");
  const fork = await ensureFork(input.token, input.upstream, sleep);
  const now = new Date().toISOString();
  const record: ForkCiRecord = {
    version: 1, upstream: input.upstream, fork, branch: input.branch, sha: input.sha, status: "running", workflows: 0,
    actions_url: actionsUrl(fork), started_at: now, updated_at: now, runs: [], failures: [], summary: [], notes: [],
  };
  let actions = await actionsStatus(input.token, fork);
  if (actions.needsUserAction) actions = await enableActions(input.token, fork);
  record.workflows = actions.workflows;
  if (actions.needsUserAction) {
    return { ...record, status: "needs_user_action", reason: actions.reason, summary: forkCiSummary("needs_user_action", null, fork) };
  }
  if (actions.workflows === 0) return { ...record, status: "no_workflows", summary: forkCiSummary("no_workflows", null, fork) };
  const repo = await githubApi<{ default_branch: string }>(`/repos/${fork}`, input.token);
  try {
    await syncFork(input.token, fork, repo.default_branch);
  } catch (error) {
    // The PR still runs; its diff just shows the fork's own commits too.
    if (!(error instanceof SyncForkError)) throw error;
    record.notes.push(error.message);
  }
  record.fork_pr = await openForkPr(input.token, fork, input.branch, input.title);
  record.summary = forkCiSummary("pending", null, fork);
  return record;
}

/** Steps 6-8, once: read the runs, classify, and close the fork PR when the
 *  result is final. Returns the updated record. */
export async function pollForkCi(token: string, record: ForkCiRecord, now = Date.now()): Promise<ForkCiRecord> {
  if (record.status !== "running") return record;
  const watch = await watchForkCi(token, record.fork, record.sha);
  const cls = classifyForkCi(watch, { workflows: record.workflows, startedAt: Date.parse(record.started_at), now });
  const next: ForkCiRecord = {
    ...record, status: cls === "pending" ? "running" : cls, updated_at: new Date(now).toISOString(),
    runs: watch.runs, failures: watch.failures, summary: forkCiSummary(cls, watch, record.fork), notes: [...record.notes],
  };
  if (cls !== "pending" && next.fork_pr && !next.fork_pr.closed) {
    try {
      await closeForkPr(token, record.fork, next.fork_pr.number);
      next.fork_pr = { ...next.fork_pr, closed: true };
    } catch (error) {
      if (!(error instanceof GitHubApiError)) throw error;
      next.notes.push(`Could not close ${next.fork_pr.url}; close it on GitHub.`);
    }
  }
  return next;
}

/** The whole check in one call: start, then poll until a final result or the
 *  timeout. For scripts and workers; the routes call the two halves. */
export async function runForkCi(input: ForkCiInput, opts: { sleep?: Sleep; pollMs?: number } = {}): Promise<ForkCiRecord> {
  const sleep = opts.sleep ?? delay;
  let record = await startForkCi(input, sleep);
  while (record.status === "running") {
    await sleep(opts.pollMs ?? 30_000);
    record = await pollForkCi(input.token, record);
  }
  return record;
}

// ── Per-run glue for /api/dispatches/<id>/fork-ci ──────────────────────

export function forkCiEnabled(): boolean {
  return process.env.OPENSRCER_FORK_CI === "1";
}

function localPath(id: string): string {
  return path.join(process.cwd(), ".dispatches", "fork-ci", `${id}.json`);
}

/** The run (owned by `owner`) and its upstream PR, or a 404. */
async function ownedRun(owner: string, id: string): Promise<{ repo: string; prUrl?: string }> {
  let run: { auth0_user_id?: string; repo_url: string; pr_url?: string } | null;
  if (cloudExecution()) {
    const { getCloudRun } = await import("./cloud-runs");
    run = await getCloudRun(owner, id);
  } else {
    run = /^d_[\w-]{1,80}$/.test(id) ? readDispatch(id) : null;
    if (run?.auth0_user_id !== owner) run = null;
  }
  if (!run) throw new ForkCiError(404, "not found");
  return { repo: run.repo_url.replace(/^https:\/\/github\.com\//, ""), prUrl: run.pr_url };
}

export async function loadForkCi(owner: string, id: string): Promise<ForkCiRecord | null> {
  if (cloudExecution()) {
    const { readJson } = await import("./blob-store");
    const found = await readJson<ForkCiRecord>(runForkCiPath(owner, id), 200_000);
    return found?.value.version === 1 ? found.value : null;
  }
  try {
    const value = JSON.parse(await readFile(localPath(id), "utf8")) as ForkCiRecord;
    return value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

async function saveForkCi(owner: string, id: string, record: ForkCiRecord): Promise<void> {
  if (cloudExecution()) {
    const [{ put }, { privateJsonOptions }] = await Promise.all([import("@vercel/blob"), import("./blob-store")]);
    await put(runForkCiPath(owner, id), JSON.stringify(record), { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
    return;
  }
  const file = localPath(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

/** POST: start (or restart) the check for a published run. The branch and
 *  SHA come from the upstream PR on GitHub now, never from the run record. */
export async function startRunForkCi(owner: string, id: string, token: string, sleep: Sleep = delay): Promise<ForkCiRecord> {
  const run = await ownedRun(owner, id);
  const pr = run.prUrl ? parseGitHubPullUrl(run.prUrl) : null;
  if (!pr) throw new ForkCiError(409, "Publish this run first: fork CI runs on the branch pushed to your fork.");
  const head = await githubApi<{ title: string; head: { sha: string; ref: string; repo: { full_name: string } | null } }>(`/repos/${pr.repoFull}/pulls/${pr.prNumber}`, token);
  if (!head.head.repo) throw new ForkCiError(409, "The PR's branch no longer exists.");
  if (head.head.repo.full_name.toLowerCase() === pr.repoFull.toLowerCase()) {
    throw new ForkCiError(409, "This PR's branch is on the project itself, so the project's CI already runs on the PR.");
  }
  const existing = await loadForkCi(owner, id);
  // The same commit is checked once; only "allow workflows first" is retried.
  if (existing && existing.sha === head.head.sha && existing.status !== "needs_user_action") return existing;
  const record = await startForkCi({ token, upstream: pr.repoFull, branch: head.head.ref, sha: head.head.sha, title: head.title }, sleep);
  await saveForkCi(owner, id, record);
  return record;
}

/** GET: the stored record, polled once on GitHub while it is running. */
export async function pollRunForkCi(owner: string, id: string, token: string | null): Promise<ForkCiRecord | null> {
  await ownedRun(owner, id);
  const record = await loadForkCi(owner, id);
  if (!record || record.status !== "running" || !token) return record;
  const next = await pollForkCi(token, record);
  await saveForkCi(owner, id, next);
  return next;
}
