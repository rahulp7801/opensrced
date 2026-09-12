import { createHash, randomBytes } from "node:crypto";
import type { DispatchRecord } from "./dispatch-store";
import { parseRunTarget } from "./run-target";

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
    typeof run.expires_at === "number" && Number.isFinite(run.expires_at) && run.expires_at > 0 &&
    typeof run.log === "string" && typeof run.log_size === "number" && Number.isSafeInteger(run.log_size) &&
    Buffer.byteLength(run.log) <= MAX_STORED_LOG_BYTES && run.log_size >= Buffer.byteLength(run.log);
}

export function cloudRunSummary(run: CloudRun): CloudRunSummary {
  return Object.fromEntries(Object.entries(run).filter(([key]) => key !== "log" && key !== "log_size")) as CloudRunSummary;
}

export function validCloudRunSummary(value: unknown, owner: string, id: string): value is CloudRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value) || "log" in value || "log_size" in value) return false;
  return validCloudRun({ ...value, log: "", log_size: 0 }, owner, id);
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

export function runPath(owner: string, id: string): string {
  if (!/^c_\d{13}_[a-f0-9]{12}$/.test(id)) throw new Error("Invalid run id");
  // Reverse timestamps make Blob's lexical listing return newest runs first.
  return `${ownerPrefix(owner)}${9999999999999 - Number(id.split("_")[1])}-${id}.json`;
}

export function runSummaryPath(owner: string, id: string): string {
  if (!/^c_\d{13}_[a-f0-9]{12}$/.test(id)) throw new Error("Invalid run id");
  return `${runSummaryPrefix(owner)}${9999999999999 - Number(id.split("_")[1])}-${id}.json`;
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
