import { del, list, put, BlobPreconditionFailedError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { Sandbox } from "@vercel/sandbox";
import type { FindingInput, StartAgenticOpts } from "./agentic-dispatcher";
import { CapacityError } from "./concurrency";
import {
  CloudRun,
  CloudRunSummary,
  cloudRunSummary,
  newCloudRunId,
  ownerPrefix,
  runIsActive,
  runPath,
  runSummaryPath,
  runSummaryPrefix,
  staleCloudRunIds,
  validCloudRun,
  validCloudRunSummary,
} from "./cloud-run-state";
import { cloudRunLease, cloudRunLeaseIsStarting } from "./cloud-leases";
import { cloudWorkerJobJson } from "./cloud-worker-job";
import { assertWorkerProtocol } from "./worker-protocol";

const TTL = 45 * 60_000;
const MAX_LISTED_RECORDS = 250;
import { readJson, updateJson, privateJsonOptions as writeOptions } from "./blob-store";

async function writeRun(path: string, run: CloudRun) {
  await put(path, JSON.stringify(run), { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
}

async function writeSummary(path: string, run: CloudRun) {
  await put(path, JSON.stringify(cloudRunSummary(run)), { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
}

function summariesReadyPath(owner: string): string {
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}run-summaries-ready.json`;
}

async function pruneCloudRunHistory(owner: string): Promise<void> {
  const page = await list({ prefix: ownerPrefix(owner), limit: 151, abortSignal: AbortSignal.timeout(8_000) });
  const staleIds = staleCloudRunIds(owner, page.blobs.map((blob) => blob.pathname));
  if (staleIds.length === 0) return;
  await del(staleIds.flatMap((id) => [
    runPath(owner, id),
    runSummaryPath(owner, id),
    `cancelled/${id}.json`,
  ]), { abortSignal: AbortSignal.timeout(8_000) });
}

/** Blob ETags make these three leases shared across function instances. */
async function reserveCapacity(path: string, expires: number): Promise<string> {
  for (let slot = 0; slot < 3; slot++) {
    const key = `capacity/${slot}.json`;
    const stored = await readJson<unknown>(key);
    const lease = stored ? cloudRunLease(stored.value) : null;
    if (lease && lease.expires > Date.now()) {
      let previous: Awaited<ReturnType<typeof readJson<unknown>>>;
      try { previous = await readJson<unknown>(lease.path); }
      catch { continue; }
      // reserveCapacity writes the lease immediately before startCloudRun
      // writes the run. Keep that normal race protected briefly. If the
      // creating function died and the record is still absent afterward,
      // reclaim the slot instead of wedging capacity for the 45-minute TTL.
      if (!previous) {
        if (cloudRunLeaseIsStarting(lease)) continue;
      } else if (typeof previous.value === "object" && previous.value !== null &&
          (previous.value as Partial<CloudRun>).id === lease.id && runIsActive(previous.value as CloudRun) &&
          !await readJson(`cancelled/${lease.id}.json`)) continue;
    }
    try {
      await put(key, JSON.stringify({ path, expires }), {
        ...writeOptions, allowOverwrite: !!stored, ...(stored ? { ifMatch: stored.etag } : {}),
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
  const summaryPath = runSummaryPath(opts.auth0UserId, id);
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
    await writeSummary(summaryPath, run);
    sandbox = await Sandbox.create({ name: run.sandbox_name, source: { type: "snapshot", snapshotId },
      persistent: false, timeout: 40 * 60_000, signal: AbortSignal.timeout(60_000) });
    await assertWorkerProtocol(sandbox);
    const tokenOptions = { allowedContentTypes: ["application/json"],
      validUntil: run.expires_at, allowOverwrite: true, addRandomSuffix: false, cacheControlMaxAge: 60 };
    const [uploadToken, summaryUploadToken] = await Promise.all([
      generateClientTokenFromReadWriteToken({ ...tokenOptions, pathname: path, maximumSizeInBytes: 600_000 }),
      generateClientTokenFromReadWriteToken({ ...tokenOptions, pathname: summaryPath, maximumSizeInBytes: 20_000 }),
    ]);
    // Only this run's upload capability and user-supplied provider credentials
    // enter the VM. Never pass AUTH0_SECRET, the Blob store token, or OIDC.
    await sandbox.runCommand({ cmd: "node", args: ["scripts/sandbox-worker.cjs"], cwd: "/vercel/sandbox",
      detached: true, signal: AbortSignal.timeout(15_000), env: {
        OPENSRCER_JOB: cloudWorkerJobJson(run, path, summaryPath, opts, finding),
        OPENSRCER_UPLOAD_TOKEN: uploadToken,
        OPENSRCER_SUMMARY_UPLOAD_TOKEN: summaryUploadToken,
        OPENSRCER_RUN_TESTS: "off",
        OPENSRCER_AGENTIC_TIMEOUT_MS: String(30 * 60_000),
      } });
    // Retention never controls whether the already-started worker succeeds.
    // Delete a bounded batch after launch so storage converges toward the
    // newest 100 runs without adding a maintenance service.
    await pruneCloudRunHistory(opts.auth0UserId).catch(() => {});
    return run;
  } catch (error) {
    await sandbox?.stop().catch(() => {});
    const log = "Could not start the isolated worker. Please retry.\n";
    const failedRun = { ...run, status: "failed" as const, ended_at: new Date().toISOString(), log, log_size: Buffer.byteLength(log) };
    await Promise.allSettled([writeRun(path, failedRun), writeSummary(summaryPath, failedRun)]);
    await updateJson<unknown>(leaseKey, { path, expires: 0 }, value => {
      const lease = cloudRunLease(value);
      return lease?.path === path ? { path, expires: 0 } : value;
    }).catch(() => {});
    throw error;
  }
}

export async function getCloudRun(owner: string, id: string): Promise<CloudRun | null> {
  if (!/^c_\d{13}_[a-f0-9]{12}$/.test(id)) return null;
  // A missing record is a normal 404. Blob timeouts and invalid JSON are
  // service failures and must reach the route so polling can retry them.
  const found = await readJson<CloudRun>(runPath(owner, id));
  if (!found || !validCloudRun(found.value, owner, id)) return null;
  const run = found.value;
  if (await readJson(`cancelled/${id}.json`)) return { ...run, status: "killed", pr_status: "none" };
  if (run.expires_at <= Date.now() && (run.status === "running" || run.pr_status === "pending")) {
    return { ...run, status: "failed", pr_status: "failed", pr_failure_reason: "Worker time limit reached or its result could not be saved." };
  }
  return run;
}

export async function listCloudRuns(owner: string, limit = 50): Promise<CloudRun[]> {
  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const runs: CloudRun[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let pages = 0;
  do {
    const page = await list({
      prefix: ownerPrefix(owner), cursor, limit: Math.min(50, MAX_LISTED_RECORDS - scanned),
      abortSignal: AbortSignal.timeout(15_000),
    });
    pages++;
    scanned += page.blobs.length;
    // Bound storage concurrency while avoiding one serial round trip per run.
    for (let i = 0; i < page.blobs.length && runs.length < cappedLimit; i += 10) {
      const batch = await Promise.all(page.blobs.slice(i, i + 10).map(async (blob) => {
        const id = /c_\d{13}_[a-f0-9]{12}/.exec(blob.pathname)?.[0];
        return id ? getCloudRun(owner, id) : null;
      }));
      runs.push(...batch.filter((run): run is CloudRun => run !== null));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (runs.length < cappedLimit && scanned < MAX_LISTED_RECORDS && pages < 5 && cursor);
  runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return runs.slice(0, cappedLimit);
}

/** Compact history for frequent dashboard polling. The first request for an
 * existing account backfills summaries from legacy full records once. */
export async function listCloudRunSummaries(owner: string, limit = 20): Promise<CloudRunSummary[]> {
  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const page = await list({ prefix: runSummaryPrefix(owner), limit: cappedLimit, abortSignal: AbortSignal.timeout(15_000) });
  const summaries = (await Promise.all(page.blobs.map(async (blob) => {
    const id = /c_\d{13}_[a-f0-9]{12}/.exec(blob.pathname)?.[0];
    if (!id) return null;
    const stored = await readJson<CloudRunSummary>(blob.pathname);
    return stored && validCloudRunSummary(stored.value, owner, id) ? stored.value : null;
  }))).filter((summary): summary is CloudRunSummary => summary !== null);
  summaries.sort((a, b) => b.started_at.localeCompare(a.started_at));

  if (await readJson(summariesReadyPath(owner))) return summaries.slice(0, cappedLimit);

  const legacy = await listCloudRuns(owner, cappedLimit);
  const known = new Set(summaries.map((summary) => summary.id));
  const missing = legacy.filter((run) => !known.has(run.id));
  const writes = await Promise.allSettled(missing.map((run) => writeSummary(runSummaryPath(owner, run.id), run)));
  if (writes.every((result) => result.status === "fulfilled")) {
    await put(summariesReadyPath(owner), JSON.stringify({ version: 1 }), {
      ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  }
  return [...summaries, ...missing.map(cloudRunSummary)]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, cappedLimit);
}

export async function cancelCloudRun(owner: string, id: string): Promise<boolean> {
  const run = await getCloudRun(owner, id);
  if (!run || !runIsActive(run)) return false;
  // A separate tombstone is outside the worker token's scope, so an upload
  // already in flight cannot undo cancellation. Persist it before contacting
  // the VM so an expired or unreachable sandbox cannot leave the run active.
  await put(`cancelled/${id}.json`, "{}", { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
  const cancelled = { ...run, status: "killed" as const, pr_status: "none" as const, ended_at: new Date().toISOString() };
  await Promise.allSettled([
    writeRun(runPath(owner, id), cancelled),
    writeSummary(runSummaryPath(owner, id), cancelled),
  ]);
  try {
    const sandbox = await Sandbox.get({ name: run.sandbox_name, signal: AbortSignal.timeout(15_000) });
    await sandbox.stop();
  } catch {
    // The durable tombstone has already cancelled the run. A missing sandbox
    // is expected when its timeout and the user's stop action cross.
  }
  return true;
}
