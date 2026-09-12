import { createHash, randomBytes } from "node:crypto";
import type { DispatchRecord } from "./dispatch-store";

export type CloudRun = DispatchRecord & {
  sandbox_name: string;
  expires_at: number;
  log: string;
  log_size: number;
};

const RUN_STATUSES = new Set(["running", "succeeded", "failed", "killed"]);
const PR_STATUSES = new Set(["opened", "failed", "pending", "tests_passed", "tests_failed", "none"]);
const TEST_STATUSES = new Set(["passed", "failed", "skipped", "not_run"]);

export function validCloudRun(value: unknown, owner: string, id: string): value is CloudRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<CloudRun>;
  return run.id === id && run.auth0_user_id === owner &&
    run.sandbox_name === id.replaceAll("_", "-") && run.mode === "agentic" && run.log_path === "" &&
    typeof run.repo_url === "string" && run.repo_url.length > 0 && run.repo_url.length <= 500 &&
    typeof run.dry_run === "boolean" && typeof run.started_at === "string" && Number.isFinite(Date.parse(run.started_at)) &&
    typeof run.status === "string" && RUN_STATUSES.has(run.status) &&
    (run.pr_status === undefined || PR_STATUSES.has(run.pr_status)) &&
    (run.tests === undefined || TEST_STATUSES.has(run.tests)) &&
    typeof run.expires_at === "number" && Number.isFinite(run.expires_at) && run.expires_at > 0 &&
    typeof run.log === "string" && typeof run.log_size === "number" && Number.isSafeInteger(run.log_size) &&
    run.log_size >= Buffer.byteLength(run.log);
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

export function runPath(owner: string, id: string): string {
  if (!/^c_\d{13}_[a-f0-9]{12}$/.test(id)) throw new Error("Invalid run id");
  // Reverse timestamps make Blob's lexical listing return newest runs first.
  return `${ownerPrefix(owner)}${9999999999999 - Number(id.split("_")[1])}-${id}.json`;
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
