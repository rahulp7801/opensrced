import { createHash, randomBytes } from "node:crypto";
import type { DispatchRecord, DispatchStats } from "./dispatch-store";
import { parseRunTarget } from "./run-target";
import { sanitizeLogValue } from "./sanitize";

export type CloudRun = DispatchRecord & {
  sandbox_name: string;
  expires_at: number;
  log: string;
  log_size: number;
};

export type CloudRunSummary = Omit<CloudRun, "log" | "log_size">;

const RUN_STATUSES = new Set(["running", "succeeded", "failed", "killed"]);
const PR_STATUSES = new Set(["opened", "failed", "pending", "tests_passed", "tests_failed", "none"]);
const TEST_STATUSES = new Set(["passed", "failed", "skipped", "not_run"]);
const MAX_STORED_LOG_BYTES = 250_000;
const RUN_ID_RE = /^c_\d{13}_[a-f0-9]{12}$/;
const MAX_CANCELLATION_RECORDS = 100;

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
    (run.pr_url === undefined || (typeof run.pr_url === "string" && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/.test(run.pr_url))) &&
    (run.pr_failure_reason === undefined || (typeof run.pr_failure_reason === "string" && run.pr_failure_reason.length <= 500)) &&
    (run.tests === undefined || TEST_STATUSES.has(run.tests)) &&
    (run.stats === undefined || validDispatchStats(run.stats)) &&
    typeof run.expires_at === "number" && Number.isFinite(run.expires_at) && run.expires_at > 0 &&
    typeof run.log === "string" && typeof run.log_size === "number" && Number.isSafeInteger(run.log_size) &&
    Buffer.byteLength(run.log) <= MAX_STORED_LOG_BYTES && run.log_size >= Buffer.byteLength(run.log);
}

export function cloudRunSummary(run: CloudRun): CloudRunSummary {
  return {
    ...Object.fromEntries(Object.entries(run).filter(([key]) => key !== "log" && key !== "log_size")),
    stats: dispatchStatsFromLog(run.log, run.stats),
  } as CloudRunSummary;
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

export function runIsActive(run: CloudRun): boolean {
  return run.expires_at > Date.now() && (run.status === "running" || run.pr_status === "pending");
}

export function runLogChunk(run: CloudRun, since: number) {
  const log = Buffer.from(run.log);
  const start = Math.max(0, run.log_size - log.length);
  const offset = Number.isFinite(since) && since >= start && since <= run.log_size ? since - start : 0;
  return { ...run, log: log.subarray(offset).toString("utf8"), log_reset: since < start || since > run.log_size };
}
