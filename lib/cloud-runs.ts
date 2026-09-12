import { list, put, BlobPreconditionFailedError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { Sandbox } from "@vercel/sandbox";
import type { FindingInput, StartAgenticOpts } from "./agentic-dispatcher";
import { CapacityError } from "./concurrency";
import { CloudRun, newCloudRunId, ownerPrefix, runIsActive, runPath } from "./cloud-run-state";

const TTL = 45 * 60_000;
import { readJson, updateJson, privateJsonOptions as writeOptions } from "./blob-store";

async function writeRun(path: string, run: CloudRun) {
  await put(path, JSON.stringify(run), { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
}

/** Blob ETags make these three leases shared across function instances. */
async function reserveCapacity(path: string, expires: number): Promise<string> {
  for (let slot = 0; slot < 3; slot++) {
    const key = `capacity/${slot}.json`;
    const lease = await readJson<{ path: string; expires: number }>(key);
    if (lease && lease.value.expires > Date.now()) {
      const previous = await readJson<CloudRun>(lease.value.path);
      if (!previous) continue;
      if (runIsActive(previous.value) && !await readJson(`cancelled/${previous.value.id}.json`)) continue;
    }
    try {
      await put(key, JSON.stringify({ path, expires }), {
        ...writeOptions, allowOverwrite: !!lease, ...(lease ? { ifMatch: lease.etag } : {}),
        abortSignal: AbortSignal.timeout(15_000),
      });
      return key;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) continue;
      throw error;
    }
  }
  throw new CapacityError("All three agent slots are busy. Try again when a run finishes.");
}

export async function startCloudRun(repo: string, issue: number, opts: StartAgenticOpts, finding?: FindingInput): Promise<CloudRun> {
  if (!opts.auth0UserId) throw new Error("Run owner is required");
  const snapshotId = process.env.OPENSRCER_WORKER_SNAPSHOT_ID;
  if (!snapshotId || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Agent hosting is not configured. A worker snapshot and private Blob store are required.");
  const id = newCloudRunId();
  const path = runPath(opts.auth0UserId, id);
  const run: CloudRun = {
    id, auth0_user_id: opts.auth0UserId, repo_url: repo, issue_number: issue,
    mode: "agentic", dry_run: opts.dryRun === true, started_at: new Date().toISOString(), status: "running",
    log_path: "", sandbox_name: id.replaceAll("_", "-"), expires_at: Date.now() + TTL,
    log: "Preparing isolated agent worker...\n", log_size: 35, tests: "not_run",
  };
  run.log_size = Buffer.byteLength(run.log);
  const leaseKey = await reserveCapacity(path, run.expires_at);
  let sandbox: Sandbox | undefined;
  try {
    await writeRun(path, run);
    sandbox = await Sandbox.create({ name: run.sandbox_name, source: { type: "snapshot", snapshotId },
      persistent: false, timeout: 40 * 60_000, signal: AbortSignal.timeout(60_000) });
    const uploadToken = await generateClientTokenFromReadWriteToken({
      pathname: path, allowedContentTypes: ["application/json"], maximumSizeInBytes: 600_000,
      validUntil: run.expires_at, allowOverwrite: true, addRandomSuffix: false, cacheControlMaxAge: 60,
    });
    // Only this run's upload capability and user-supplied provider credentials
    // enter the VM. Never pass AUTH0_SECRET, the Blob store token, or OIDC.
    await sandbox.runCommand({ cmd: "node", args: ["scripts/sandbox-worker.cjs"], cwd: "/vercel/sandbox",
      detached: true, signal: AbortSignal.timeout(15_000), env: {
        OPENSRCER_JOB: JSON.stringify({ run, path, finding, opts: { ...opts, installationToken: Boolean(opts.orgCtx), orgCtx: undefined } }),
        OPENSRCER_UPLOAD_TOKEN: uploadToken,
        OPENSRCER_RUN_TESTS: "off",
        OPENSRCER_AGENTIC_TIMEOUT_MS: String(30 * 60_000),
      } });
    return run;
  } catch (error) {
    await sandbox?.stop().catch(() => {});
    const log = "Could not start the isolated worker. Please retry.\n";
    await writeRun(path, { ...run, status: "failed", ended_at: new Date().toISOString(), log, log_size: Buffer.byteLength(log) }).catch(() => {});
    await updateJson(leaseKey, { path, expires: 0 }, lease => lease.path === path ? { path, expires: 0 } : lease).catch(() => {});
    throw error;
  }
}

export async function getCloudRun(owner: string, id: string): Promise<CloudRun | null> {
  if (!/^c_\d{13}_[a-f0-9]{12}$/.test(id)) return null;
  const found = await readJson<CloudRun>(runPath(owner, id));
  if (!found || found.value.id !== id || found.value.auth0_user_id !== owner) return null;
  const run = found.value;
  if (await readJson(`cancelled/${id}.json`)) return { ...run, status: "killed", pr_status: "none" };
  if (run.expires_at <= Date.now() && (run.status === "running" || run.pr_status === "pending")) {
    return { ...run, status: "failed", pr_status: "failed", pr_failure_reason: "Worker time limit reached or its result could not be saved." };
  }
  return run;
}

export async function listCloudRuns(owner: string, limit = 50): Promise<CloudRun[]> {
  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const page = await list({ prefix: ownerPrefix(owner), limit: cappedLimit, abortSignal: AbortSignal.timeout(15_000) });
  const runs: CloudRun[] = [];
  // Bound storage concurrency while avoiding one serial round trip per run.
  for (let i = 0; i < page.blobs.length; i += 10) {
    const batch = await Promise.all(page.blobs.slice(i, i + 10).map(async (blob) => {
      const id = /c_\d{13}_[a-f0-9]{12}/.exec(blob.pathname)?.[0];
      return id ? getCloudRun(owner, id) : null;
    }));
    runs.push(...batch.filter((run): run is CloudRun => run !== null));
  }
  return runs;
}

export async function cancelCloudRun(owner: string, id: string): Promise<boolean> {
  const run = await getCloudRun(owner, id);
  if (!run || !runIsActive(run)) return false;
  // A separate tombstone is outside the worker token's scope, so an upload
  // already in flight cannot undo cancellation. Persist it before contacting
  // the VM so an expired or unreachable sandbox cannot leave the run active.
  await put(`cancelled/${id}.json`, "{}", { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
  const cancelled = { ...run, status: "killed" as const, pr_status: "none" as const, ended_at: new Date().toISOString() };
  await writeRun(runPath(owner, id), cancelled).catch(() => {});
  try {
    const sandbox = await Sandbox.get({ name: run.sandbox_name, signal: AbortSignal.timeout(15_000) });
    await sandbox.stop();
  } catch {
    // The durable tombstone has already cancelled the run. A missing sandbox
    // is expected when its timeout and the user's stop action cross.
  }
  return true;
}
