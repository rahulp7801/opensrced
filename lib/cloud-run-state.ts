import { createHash, randomBytes } from "node:crypto";
import type { DispatchRecord, DispatchStats } from "./dispatch-store";
import { parseRunTarget } from "./run-target";
import { sanitizeLogValue } from "./sanitize";
import { validSignInState, type SignInState } from "./hosted-sign-in";

export type CloudRun = DispatchRecord & {
  sandbox_name: string;
  /** Set once the app confirmed the run's VM is stopped. */
  sandbox_stopped?: boolean;
  expires_at: number;
  log: string;
  log_size: number;
  /** Hosted subscription runs: the Claude sign-in link the user must open. */
  sign_in?: SignInState;
};

export type CloudRunSummary = Omit<CloudRun, "log" | "log_size">;

const RUN_STATUSES = new Set(["running", "succeeded", "failed", "killed"]);
const PR_STATUSES = new Set(["opened", "failed", "pending", "tests_passed", "tests_failed", "awaiting_review", "blocked", "none"]);
const TEST_STATUSES = new Set(["passed", "failed", "skipped", "not_run"]);
const MAX_STORED_LOG_BYTES = 250_000;
const RUN_ID_RE = /^c_\d{13}_[a-f0-9]{12}$/;
const MAX_CANCELLATION_RECORDS = 100;
/** Sandbox VM lifetime. The worker must finish (and record failure) inside it. */
export const WORKER_TIMEOUT_MS = 40 * 60_000;

export type CloudRunCancellation = { id: string; cancelled_at: string };

/** Metadata needed by history views, extracted while the worker already has
 * the log in memory. Keeping it in the compact summary prevents Activity and
 * Pull Requests from downloading every full log on each refresh. */
export function dispatchStatsFromLog(log: string, previous?: DispatchStats): DispatchStats {
  const costs = [...log.matchAll(/^\[agentic-dispatcher\] total_cost_usd=(\d+(?:\.\d+)?)\s*$/gm)];
  const parsedCost = costs.length ? Number(costs.at(-1)![1]) : null;
  const rawTitle = /^##\s+PR title\s*\n+([^\r\n]+)/im.exec(log)?.[1];
  const prTitle = rawTitle
    ? sanitizeLogValue(rawTitle, 240).replace(/^[`#*>\s-]+/, "").replace(/[`*_\s]+$/, "").slice(0, 200)
    : previous?.pr_title;
  return {
    cost_usd: parsedCost !== null && Number.isFinite(parsedCost) ? parsedCost : previous?.cost_usd ?? null,
    has_diff: previous?.has_diff === true || /```(?:diff|patch)\s*\n/i.test(log),
    ...(prTitle ? { pr_title: prTitle } : {}),
  };
}

function validDispatchStats(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stats = value as Partial<DispatchStats>;
  return (stats.cost_usd === null || (typeof stats.cost_usd === "number" && Number.isFinite(stats.cost_usd) && stats.cost_usd >= 0 && stats.cost_usd <= 10_000)) &&
    typeof stats.has_diff === "boolean" &&
    (stats.pr_title === undefined || (typeof stats.pr_title === "string" && stats.pr_title.length > 0 && stats.pr_title.length <= 200 && !/[\x00-\x1F\x7F]/.test(stats.pr_title)));
}

function isCanonicalRepoUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try { return value === `https://github.com/${parseRunTarget(value).repo}`; }
  catch { return false; }
}

export function validCloudRun(value: unknown, owner: string, id: string): value is CloudRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<CloudRun>;
  return run.id === id && run.auth0_user_id === owner &&
    run.sandbox_name === id.replaceAll("_", "-") && run.mode === "agentic" && run.log_path === "" &&
    isCanonicalRepoUrl(run.repo_url) &&
    (run.issue_number === undefined || (Number.isSafeInteger(run.issue_number) && run.issue_number! >= 0)) &&
    (run.issue_title === undefined || (typeof run.issue_title === "string" && run.issue_title.length <= 500)) &&
    typeof run.dry_run === "boolean" && typeof run.started_at === "string" && Number.isFinite(Date.parse(run.started_at)) &&
    (run.ended_at === undefined || (typeof run.ended_at === "string" && Number.isFinite(Date.parse(run.ended_at)))) &&
    typeof run.status === "string" && RUN_STATUSES.has(run.status) &&
    (run.pr_status === undefined || PR_STATUSES.has(run.pr_status)) &&
    // The PR must be on the run's own repository (fork PRs are opened upstream),
    // so a rewritten record cannot point the "View PR" link anywhere else.
    (run.pr_url === undefined || (typeof run.pr_url === "string" && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/.test(run.pr_url) &&
      run.pr_url.toLowerCase().startsWith(`${run.repo_url!.toLowerCase()}/pull/`))) &&
    // Same rule for the PR a follow-up run updates.
    (run.followup_pr === undefined || (typeof run.followup_pr === "string" && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/.test(run.followup_pr) &&
      run.followup_pr.toLowerCase().startsWith(`${run.repo_url!.toLowerCase()}/pull/`))) &&
    (run.pr_failure_reason === undefined || (typeof run.pr_failure_reason === "string" && run.pr_failure_reason.length <= 500)) &&
    (run.tests === undefined || TEST_STATUSES.has(run.tests)) &&
    (run.stats === undefined || validDispatchStats(run.stats)) &&
    // Only an Anthropic authorize URL; a worker cannot plant any other link.
    (run.sign_in === undefined || validSignInState(run.sign_in)) &&
    typeof run.expires_at === "number" && Number.isFinite(run.expires_at) && run.expires_at > 0 &&
    // The worker can rewrite its own record, so expiry is bounded by the
    // server-minted id (c_<ms>_...), not by any field the worker controls:
    // a forged far-future expiry would otherwise keep a slot busy forever.
    run.expires_at <= Number(id.slice(2, 15)) + MAX_RUN_LIFETIME_MS &&
    typeof run.log === "string" && typeof run.log_size === "number" && Number.isSafeInteger(run.log_size) &&
    Buffer.byteLength(run.log) <= MAX_STORED_LOG_BYTES && run.log_size >= Buffer.byteLength(run.log);
}

export function cloudRunSummary(run: CloudRun): CloudRunSummary {
  return {
    ...Object.fromEntries(Object.entries(run).filter(([key]) => key !== "log" && key !== "log_size")),
    stats: dispatchStatsFromLog(run.log, run.stats),
  } as CloudRunSummary;
}

/** Log progress goes up at most this often; status and sign-in changes at once. */
export const WORKER_PROGRESS_MS = 10_000;
const WORKER_STATS_MS = 60_000;

/** What a worker should upload for `record` (the bodies to write, or null):
 *  Blob writes are the scarce operation, so unchanged or merely progressing
 *  records wait. The summary feeds history views; while a run is running it
 *  differs only in cost stats, which refresh at most once a minute. */
export function workerUploads(
  record: CloudRun,
  last: Pick<CloudRun, "status" | "sign_in">,
  uploaded: { record: string; summary: string; recordAt: number; summaryAt: number },
  now: number,
): { record: string | null; summary: string | null } {
  const body = JSON.stringify(record);
  if (body === uploaded.record) return { record: null, summary: null };
  const urgent = record.status !== "running" || record.status !== last.status ||
    JSON.stringify(record.sign_in) !== JSON.stringify(last.sign_in);
  if (!urgent && now - uploaded.recordAt < WORKER_PROGRESS_MS) return { record: null, summary: null };
  const summary = JSON.stringify(cloudRunSummary(record));
  const statsOnly = Boolean(uploaded.summary) &&
    JSON.stringify({ ...JSON.parse(uploaded.summary), stats: null }) === JSON.stringify({ ...JSON.parse(summary), stats: null });
  const summaryDue = summary !== uploaded.summary && (urgent || !statsOnly || now - uploaded.summaryAt >= WORKER_STATS_MS);
  return { record: body, summary: summaryDue ? summary : null };
}

export function validCloudRunSummary(value: unknown, owner: string, id: string): value is CloudRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value) || "log" in value || "log_size" in value) return false;
  return validCloudRun({ ...value, log: "", log_size: 0 }, owner, id);
}

export function effectiveCloudRunState<T extends CloudRunSummary>(run: T, now = Date.now()): T {
  if (run.expires_at > now || (run.status !== "running" && run.pr_status !== "pending")) return run;
  return {
    ...run,
    status: "failed",
    pr_status: "failed",
    pr_failure_reason: "Worker time limit reached or its result could not be saved.",
  } as T;
}

export function cloudExecution(): boolean {
  return process.env.VERCEL === "1" || process.env.OPENSRCER_EXECUTION === "sandbox";
}

/** A run record expires 45 minutes after its id was minted (cloud-runs TTL). */
const MAX_RUN_LIFETIME_MS = 46 * 60_000;

export function newCloudRunId(): string {
  return `c_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

export function ownerPrefix(owner: string): string {
  if (!owner) throw new Error("Run owner is required");
  return `users/${createHash("sha256").update(owner).digest("hex")}/runs/`;
}

export function runSummaryPrefix(owner: string): string {
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}run-summaries/`;
}

export function runCancellationPath(owner: string, id: string): string {
  if (!RUN_ID_RE.test(id)) throw new Error("Invalid run id");
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}cancelled-runs/${id}.json`;
}

export function runCancellationIndexPath(owner: string): string {
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}cancelled-runs.json`;
}

export function normalizeCloudRunCancellations(value: unknown): CloudRunCancellation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is CloudRunCancellation => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const candidate = item as Partial<CloudRunCancellation>;
      return typeof candidate.id === "string" && RUN_ID_RE.test(candidate.id) &&
        typeof candidate.cancelled_at === "string" && candidate.cancelled_at.length === 24 &&
        Number.isFinite(Date.parse(candidate.cancelled_at)) &&
        new Date(candidate.cancelled_at).toISOString() === candidate.cancelled_at;
    })
    .sort((a, b) => b.cancelled_at.localeCompare(a.cancelled_at))
    .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
    .slice(0, MAX_CANCELLATION_RECORDS);
}

export function addCloudRunCancellation(value: unknown, cancellation: CloudRunCancellation): CloudRunCancellation[] {
  return normalizeCloudRunCancellations([cancellation, ...normalizeCloudRunCancellations(value)]);
}

/** The newest run summaries in one record, so history views poll with reads
 *  instead of a Blob listing (listings are the scarce "advanced" operation). */
export const RUN_INDEX_SIZE = 50;

export function runIndexPath(owner: string): string {
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}run-index.json`;
}

/** The index's valid entries for this owner, newest first. */
export function indexedRuns(value: unknown, owner: string): CloudRunSummary[] {
  const runs = (value as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) return [];
  const seen = new Set<string>();
  return runs
    .filter((run): run is CloudRunSummary => typeof run?.id === "string" && RUN_ID_RE.test(run.id) &&
      validCloudRunSummary(run, owner, run.id) && !seen.has(run.id) && Boolean(seen.add(run.id)))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, RUN_INDEX_SIZE);
}

/** `summaries` replace their entries in the index; undefined when there is no
 *  index yet (the next history read builds it from storage). */
export function withIndexedRuns(value: unknown, owner: string, summaries: CloudRunSummary[]): { version: 1; runs: CloudRunSummary[] } | undefined {
  if (!value) return undefined;
  const ids = new Set(summaries.map((run) => run.id));
  return { version: 1, runs: indexedRuns({ runs: [...summaries, ...indexedRuns(value, owner).filter((run) => !ids.has(run.id))] }, owner) };
}

export function cancelledCloudRunState<T extends CloudRunSummary>(run: T, cancelledAt: string): T {
  return {
    ...run,
    status: "killed",
    pr_status: "none",
    ended_at: cancelledAt,
  } as T;
}

export function runPath(owner: string, id: string): string {
  if (!RUN_ID_RE.test(id)) throw new Error("Invalid run id");
  // Reverse timestamps make Blob's lexical listing return newest runs first.
  return `${ownerPrefix(owner)}${9999999999999 - Number(id.split("_")[1])}-${id}.json`;
}

/** The run's frozen publish-gate preview (patch + PR text), uploaded by the
 *  worker with its own path-scoped token. */
export function runPreviewPath(owner: string, id: string): string {
  if (!RUN_ID_RE.test(id)) throw new Error("Invalid run id");
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}previews/${id}.json`;
}

/** Created once per publish; a second concurrent publish finds it. */
export function runPublishLockPath(owner: string, id: string): string {
  if (!RUN_ID_RE.test(id)) throw new Error("Invalid run id");
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}publishing/${id}.json`;
}

export function runSummaryPath(owner: string, id: string): string {
  if (!RUN_ID_RE.test(id)) throw new Error("Invalid run id");
  return `${runSummaryPrefix(owner)}${9999999999999 - Number(id.split("_")[1])}-${id}.json`;
}

/** Select only canonical records owned by this user. Paths sort newest first
 * because their timestamps are reversed, matching the Blob listing scheme. */
export function staleCloudRunIds(owner: string, paths: string[], keep = 100, limit = 50): string[] {
  const prefix = ownerPrefix(owner);
  return paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => ({ path, match: /^(\d{13})-(c_(\d{13})_[a-f0-9]{12})\.json$/.exec(path.slice(prefix.length)) }))
    .filter(({ match }) => match && Number(match[1]) === 9999999999999 - Number(match[3]))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(Math.max(0, keep), Math.max(0, keep) + Math.max(0, limit))
    .map(({ match }) => match![2]);
}

export function runIsActive(run: Pick<CloudRun, "expires_at" | "status" | "pr_status">): boolean {
  return run.expires_at > Date.now() && (run.status === "running" || run.pr_status === "pending");
}

export function runLogChunk(run: CloudRun, since: number) {
  const log = Buffer.from(run.log);
  const start = Math.max(0, run.log_size - log.length);
  const offset = Number.isFinite(since) && since >= start && since <= run.log_size ? since - start : 0;
  const reset = since < start || since > run.log_size;
  // The stored log is an exact file suffix; say so when serving it whole.
  const notice = reset && start > 0 ? "…(earlier output omitted)…\n" : "";
  return { ...run, log: notice + log.subarray(offset).toString("utf8"), log_reset: reset };
}
