import { del, list, put, BlobPreconditionFailedError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { APIError, Sandbox } from "@vercel/sandbox";
import { fetchIssue, type FindingInput, type StartAgenticOpts } from "./agentic-dispatcher";
import { parseRunTarget } from "./run-target";
import { CapacityError } from "./concurrency";
import {
  CloudRun,
  CloudRunSummary,
  addCloudRunCancellation,
  cancelledCloudRunState,
  cloudRunSummary,
  effectiveCloudRunState,
  newCloudRunId,
  ownerPrefix,
  normalizeCloudRunCancellations,
  runCancellationIndexPath,
  runCancellationPath,
  runIsActive,
  runPath,
  runSummaryPath,
  runSummaryPrefix,
  staleCloudRunIds,
  validCloudRun,
  validCloudRunSummary,
  WORKER_TIMEOUT_MS,
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

/** Stop a run's VM by name, so it works even when Sandbox.create's response
 *  never arrived. True once no VM can still be running: stopped, gone, or
 *  never created. False means one may still be alive (and billed). */
async function stopSandbox(name: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sandbox = await Sandbox.get({ name, signal: AbortSignal.timeout(15_000) });
      if (["stopped", "failed", "aborted"].includes(sandbox.status)) return true;
      await sandbox.stop({ signal: AbortSignal.timeout(15_000) });
      return true;
    } catch (error) {
      if (error instanceof APIError && error.response.status === 404) return true;
    }
  }
  return false;
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
    runCancellationPath(owner, id),
  ]), { abortSignal: AbortSignal.timeout(8_000) });
}

/** One account may hold this many of the three agent slots at once. */
const PER_OWNER_RUNS = 2;

type StoredLease = Awaited<ReturnType<typeof readJson<unknown>>>;

/** Whether a slot's lease still belongs to live work, and the finished run
 *  behind it (if any). reserveCapacity writes the lease immediately before
 *  startCloudRun writes the run, so a missing record is protected briefly; if
 *  the creating function died, the slot is reclaimed instead of wedging
 *  capacity for the 45-minute TTL. */
async function slotState(stored: StoredLease): Promise<{ busy: boolean; owner?: string; finishedRunId?: string }> {
  const lease = stored ? cloudRunLease(stored.value) : null;
  if (!lease || lease.expires <= Date.now()) return { busy: false };
  const owner = lease.path.slice(0, lease.path.lastIndexOf("/") + 1);
  let previous: StoredLease;
  try { previous = await readJson<unknown>(lease.path); }
  catch { return { busy: true, owner }; }
  if (!previous) return { busy: cloudRunLeaseIsStarting(lease), owner };
  const prior = typeof previous.value === "object" && previous.value !== null &&
    (previous.value as Partial<CloudRun>).id === lease.id ? previous.value as CloudRun : null;
  const busy = Boolean(prior && runIsActive(prior) &&
    !await readJson(lease.path.replace(/\/runs\/[^/]+$/, `/cancelled-runs/${lease.id}.json`)));
  // Name the VM from the lease's own id, never from the record: a worker
  // can rewrite its record, and must not be able to aim this at another VM.
  return { busy, owner, finishedRunId: !busy && prior && !prior.sandbox_stopped ? lease.id : undefined };
}

async function ownerSlots(ownerRuns: string): Promise<number> {
  let held = 0;
  for (let slot = 0; slot < 3; slot++) {
    const state = await slotState(await readJson<unknown>(`capacity/${slot}.json`));
    if (state.busy && state.owner === ownerRuns) held++;
  }
  return held;
}

/** Blob ETags make these three leases shared across function instances.
 *  Exported for tests. */
export async function reserveCapacity(path: string, expires: number): Promise<string> {
  // Run paths are users/<owner hash>/runs/<id>.json; the directory names the owner.
  const ownerRuns = path.slice(0, path.lastIndexOf("/") + 1);
  const tooMany = () => new CapacityError(`You already have ${PER_OWNER_RUNS} runs in progress. Try again when one finishes.`);
  let mine = 0;
  const reclaimable: Array<{ key: string; stored: StoredLease; finishedRunId?: string }> = [];
  for (let slot = 0; slot < 3; slot++) {
    const key = `capacity/${slot}.json`;
    const stored = await readJson<unknown>(key);
    const state = await slotState(stored);
    if (state.busy) {
      if (state.owner === ownerRuns) mine++;
      continue;
    }
    reclaimable.push({ key, stored, finishedRunId: state.finishedRunId });
  }
  if (mine >= PER_OWNER_RUNS) throw tooMany();
  for (const { key, stored, finishedRunId } of reclaimable) {
    try {
      await put(key, JSON.stringify({ path, expires, reserved: Date.now() }), {
        ...writeOptions, allowOverwrite: !!stored, ...(stored ? { ifMatch: stored.etag } : {}),
        abortSignal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) continue;
      throw error;
    }
    // Simultaneous requests from one account all pass the count above. Re-count
    // with this lease in place and back out if the account is over its share;
    // racing requests then all back out, which errs toward refusing.
    if (await ownerSlots(ownerRuns) > PER_OWNER_RUNS) {
      await updateJson<unknown>(key, { path, expires: 0 }, value => {
        const lease = cloudRunLease(value);
        return lease?.path === path ? { path, expires: 0 } : value;
      }).catch(() => {});
      throw tooMany();
    }
    // A finished run's VM idles (billed) until its 40-minute timeout unless
    // someone polls the run. Reusing its slot is the moment to stop it.
    if (finishedRunId) await stopSandbox(finishedRunId.replaceAll("_", "-"));
    return key;
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
  // A missing issue or a pull request number would otherwise start (and bill)
  // a VM that fails at once. Skipped without a user token: anonymous GitHub
  // calls from shared egress IPs exhaust their rate limit quickly.
  if (!finding && opts.token) await fetchIssue(parseRunTarget(repo).repo, issue, opts.token);
  const run: CloudRun = {
    id, auth0_user_id: opts.auth0UserId, repo_url: repo, issue_number: issue,
    mode: "agentic", dry_run: opts.dryRun === true, started_at: new Date().toISOString(), status: "running",
    log_path: "", sandbox_name: id.replaceAll("_", "-"), expires_at: Date.now() + TTL,
    log: "Preparing isolated agent worker...\n", log_size: 35, tests: "not_run",
  };
  run.log_size = Buffer.byteLength(run.log);
  const leaseKey = await reserveCapacity(path, run.expires_at);
  try {
    await writeRun(path, run);
    await writeSummary(summaryPath, run);
    const sandbox = await Sandbox.create({ name: run.sandbox_name, source: { type: "snapshot", snapshotId },
      persistent: false, timeout: WORKER_TIMEOUT_MS, signal: AbortSignal.timeout(60_000) });
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
    await stopSandbox(run.sandbox_name);
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
  if (await readJson(runCancellationPath(owner, id))) return { ...run, status: "killed", pr_status: "none" };
  const effective = effectiveCloudRunState(run);
  // A finished worker exits, but its VM stays up (and billed) until the
  // 40-minute timeout; nothing inside it can stop it. Stop it on first sight.
  // ponytail: runs nobody polls idle until timeout; a sweeper would close that.
  if (!runIsActive(effective) && !run.sandbox_stopped && await stopSandbox(run.sandbox_name)) {
    await writeRun(runPath(owner, id), { ...run, sandbox_stopped: true }).catch(() => {});
  }
  return effective;
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
  const [page, cancellationRecord] = await Promise.all([
    list({ prefix: runSummaryPrefix(owner), limit: cappedLimit, abortSignal: AbortSignal.timeout(15_000) }),
    readJson<unknown>(runCancellationIndexPath(owner), 20_000),
  ]);
  const cancellations = new Map(
    normalizeCloudRunCancellations(cancellationRecord?.value).map((item) => [item.id, item.cancelled_at]),
  );
  const summaries = (await Promise.all(page.blobs.map(async (blob) => {
    const id = /c_\d{13}_[a-f0-9]{12}/.exec(blob.pathname)?.[0];
    if (!id) return null;
    const stored = await readJson<CloudRunSummary>(blob.pathname);
    if (!stored || !validCloudRunSummary(stored.value, owner, id)) return null;
    const cancelledAt = cancellations.get(id);
    return cancelledAt ? cancelledCloudRunState(stored.value, cancelledAt) : effectiveCloudRunState(stored.value);
  }))).filter((summary): summary is CloudRunSummary => summary !== null);
  summaries.sort((a, b) => b.started_at.localeCompare(a.started_at));

  const marker = await readJson<{ version?: unknown }>(summariesReadyPath(owner));
  if (marker?.value.version === 2) return summaries.slice(0, cappedLimit);

  const legacy = await listCloudRuns(owner, cappedLimit);
  const known = new Map(summaries.map((summary) => [summary.id, summary]));
  // Version 2 also refreshes summaries written before derived activity and PR
  // metadata existed. This is one bounded legacy read per account, not a cost
  // paid on every Activity or Pull Requests refresh.
  const stale = legacy.filter((run) => !known.get(run.id)?.stats);
  const writes = await Promise.allSettled(stale.map((run) => writeSummary(runSummaryPath(owner, run.id), run)));
  if (writes.every((result) => result.status === "fulfilled")) {
    await put(summariesReadyPath(owner), JSON.stringify({ version: 2 }), {
      ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  }
  const merged = new Map(summaries.map((summary) => [summary.id, summary]));
  stale.forEach((run) => merged.set(run.id, cloudRunSummary(run)));
  return [...merged.values()]
    .map((run) => {
      const cancelledAt = cancellations.get(run.id);
      return cancelledAt ? cancelledCloudRunState(run, cancelledAt) : run;
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, cappedLimit);
}

export async function cancelCloudRun(owner: string, id: string): Promise<boolean> {
  const run = await getCloudRun(owner, id);
  if (!run || !runIsActive(run)) return false;
  // A separate tombstone is outside the worker token's scope, so an upload
  // already in flight cannot undo cancellation. Persist it before contacting
  // the VM so an expired or unreachable sandbox cannot leave the run active.
  const cancelledAt = new Date().toISOString();
  await put(runCancellationPath(owner, id), "{}", { ...writeOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
  // The compact index gives frequently-polled history views one durable read
  // instead of one tombstone lookup per row. Write it before stopping the VM
  // so even an unreachable worker cannot resurrect its summary in the UI.
  let indexSaved = true;
  await updateJson<unknown>(runCancellationIndexPath(owner), [], value =>
    addCloudRunCancellation(value, { id, cancelled_at: cancelledAt })).catch(() => { indexSaved = false; });
  // The durable tombstone has already cancelled the run. If the VM cannot be
  // confirmed stopped it may still finish and publish, so say so in the log.
  const stopped = await stopSandbox(run.sandbox_name);
  const note = stopped ? "" : "\nCancelled, but the worker could not be confirmed stopped. It ends within 40 minutes and may still open a draft PR.\n";
  const cancelled = { ...cancelledCloudRunState(run, cancelledAt), sandbox_stopped: stopped,
    log: run.log + note, log_size: run.log_size + Buffer.byteLength(note) };
  await Promise.allSettled([
    writeRun(runPath(owner, id), cancelled),
    writeSummary(runSummaryPath(owner, id), cancelled),
  ]);
  if (!indexSaved) {
    await updateJson<unknown>(runCancellationIndexPath(owner), [], value =>
      addCloudRunCancellation(value, { id, cancelled_at: cancelledAt })).catch(() => {});
  }
  return true;
}
