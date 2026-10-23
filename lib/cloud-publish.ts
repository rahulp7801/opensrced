// Hosted half of the publish gate. The worker VM uploaded the run's frozen
// preview (patch + PR text) to a private Blob next to the run record; this
// checks it exactly like a local publish (lib/publish.ts) and then opens the
// draft PR from a short-lived push VM that holds only the user's GitHub
// token and egress to GitHub (scripts/sandbox-publish.cjs).

import { del, put } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { readJson, privateJsonOptions } from "./blob-store";
import { reserveCloudSlot } from "./cloud-capacity";
import { getCloudRun, listCloudRunSummaries } from "./cloud-runs";
import { runPath, runPreviewPath, runPublishLockPath, runSummaryPath, cloudRunSummary, type CloudRun } from "./cloud-run-state";
import { PUSH_EGRESS } from "./sandbox-egress";
import { assertWorkerProtocol } from "./worker-protocol";
import { assertPublishable, followupGuards, followupPushTarget, liveGuards, PublishError, type PublishInput, type StoredPreview } from "./publish";
import { cloudPush } from "./cloud-push";
import { testOutcome } from "./verify";
import type { PrPreview } from "./pr-preview";
import { parseRunTarget } from "./run-target";

/** The stored preview, or null. The worker wrote it, so its shape is checked. */
export async function getCloudPreview(owner: string, id: string): Promise<StoredPreview | null> {
  const found = await readJson<PrPreview & { diff?: unknown }>(runPreviewPath(owner, id), 1_000_000);
  if (!found) return null;
  const { diff, ...preview } = found.value;
  if (preview.version !== 1 || typeof preview.title !== "string" || typeof preview.body !== "string" ||
      typeof preview.commit_message !== "string" || !Array.isArray(preview.blockers) || typeof diff !== "string") return null;
  return { preview: preview as PrPreview, diff };
}

export type PublishJob = {
  repo: string; issueNumber: number; dispatchId: string; findingId?: string;
  stored: StoredPreview; author: { login: string; id: number };
};

export type PublishJobResult = { ok: true; url: string; tests: string } | { ok: false; reason: string };

/** Runs scripts/sandbox-publish.cjs in a push VM. Replaceable in tests. */
export async function runPublishJob(job: PublishJob, token: string, signal: AbortSignal, ownerId: string): Promise<PublishJobResult> {
  const snapshotId = process.env.OPENSRCER_WORKER_SNAPSHOT_ID;
  if (!snapshotId || !process.env.BLOB_READ_WRITE_TOKEN) throw new PublishError(503, "Publishing is not configured on this deployment.");
  const release = await reserveCloudSlot("push", 2, 6 * 60_000, ownerId);
  let sandbox: Sandbox | undefined;
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]);
    sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId }, networkPolicy: PUSH_EGRESS, persistent: false, timeout: 5 * 60_000, signal: bounded });
    await assertWorkerProtocol(sandbox, bounded);
    const command = await sandbox.runCommand({ cmd: "node", args: ["scripts/sandbox-publish.cjs"], cwd: "/vercel/sandbox",
      env: { OPENSRCER_PUBLISH: JSON.stringify({ job, token }) }, signal: bounded });
    const result = JSON.parse((await command.stdout()).trim().split("\n").pop() || "{}") as PublishJobResult;
    if (command.exitCode !== 0 && result.ok) return { ok: false, reason: "The publish worker failed." };
    return result.ok || typeof result.reason === "string" ? result : { ok: false, reason: "The publish worker failed." };
  } finally {
    const stopped = !sandbox || await sandbox.stop().then(() => true, () => false);
    if (stopped) await release().catch(() => {});
  }
}

/** Append to the stored log, keeping it under the record's size cap. */
function withLog(run: CloudRun, text: string): Pick<CloudRun, "log" | "log_size"> {
  const log = Buffer.from(run.log + text);
  return { log: log.subarray(Math.max(0, log.length - 240_000)).toString("utf8").replace(/^�+/, ""), log_size: run.log_size + Buffer.byteLength(text) };
}

async function writeRecord(owner: string, run: CloudRun) {
  const options = { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) };
  await Promise.all([
    put(runPath(owner, run.id), JSON.stringify(run), options),
    put(runSummaryPath(owner, run.id), JSON.stringify(cloudRunSummary(run)), options),
  ]);
}

export async function publishCloudRun(
  input: PublishInput & { signal: AbortSignal },
  job: typeof runPublishJob = runPublishJob,
  push: typeof cloudPush = cloudPush,
): Promise<{ url: string; tests: string }> {
  const run = await getCloudRun(input.viewerId, input.id);
  if (!run) throw new PublishError(404, "not found");
  const stored = assertPublishable(run, input.confirmed, await getCloudPreview(input.viewerId, input.id));
  if (!input.token || !input.author) throw new PublishError(401, "Sign in with GitHub again: the PR is opened from your account.");
  const repo = parseRunTarget(run.repo_url).repo;
  const issue = run.issue_number ?? 0;
  // A follow-up updates the user's own PR: AI-policy check only, and the
  // branch comes from GitHub now, not from the (worker-written) record.
  const followup = run.followup_pr ? (followupGuards(stored.preview), await followupPushTarget(run.followup_pr, input.token, input.author.login)) : null;
  if (!followup) {
    const history = await listCloudRunSummaries(input.viewerId, 50);
    await liveGuards({ repoFull: repo, issue, token: input.token, login: input.author.login, preview: stored.preview, publishedAt: history.map((r) => r.published_at) });
  }

  // One publish per run, across function instances: the lock blob is created
  // without overwrite, so a second click finds it and stops.
  try {
    await put(runPublishLockPath(input.viewerId, input.id), JSON.stringify({ at: new Date().toISOString() }), { ...privateJsonOptions, allowOverwrite: false, abortSignal: AbortSignal.timeout(15_000) });
  } catch {
    throw new PublishError(409, "Publishing already started for this run.");
  }
  const note = `\n[publish] confirmed by the owner at ${new Date().toISOString()}\n`;
  if (followup) {
    const tests = testOutcome(stored.preview.executed ? stored.preview.verification : null);
    let message: string;
    try {
      message = String((await push({ repo: followup.repo, branch: followup.branch, diff: stored.diff, commit_message: stored.preview.commit_message, author: input.author }, input.token, input.signal, input.viewerId)).message ?? "Pushed");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The isolated push failed.";
      await writeRecord(input.viewerId, { ...run, pr_status: "failed", pr_failure_reason: reason.slice(0, 500), ...withLog(run, note) }).catch(() => {});
      await del(runPublishLockPath(input.viewerId, input.id), { abortSignal: AbortSignal.timeout(15_000) }).catch(() => {});
      throw new PublishError(502, reason.slice(0, 500));
    }
    // No published_at: a follow-up commit is not a new PR for the daily cap.
    await writeRecord(input.viewerId, { ...run, pr_status: "opened", pr_url: followup.url, tests, ...withLog(run, `${note}[publish] ${message} (follow-up to ${followup.url})\n`) });
    return { url: followup.url, tests };
  }
  const result = await job({ repo, issueNumber: issue, dispatchId: run.id, findingId: run.finding_id, stored, author: input.author }, input.token, input.signal, input.viewerId)
    .catch((error): PublishJobResult => ({ ok: false, reason: error instanceof PublishError ? error.message : "The publish worker failed." }));
  if (!result.ok) {
    const failed: CloudRun = { ...run, pr_status: "failed", pr_failure_reason: result.reason.slice(0, 500), ...withLog(run, note) };
    await writeRecord(input.viewerId, failed).catch(() => {});
    // A failed attempt may be retried from the run page.
    await del(runPublishLockPath(input.viewerId, input.id), { abortSignal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new PublishError(502, result.reason.slice(0, 500));
  }
  const line = `${note}[agentic-pr] opened draft PR: ${result.url}\n`;
  const opened: CloudRun = { ...run, pr_status: "opened", pr_url: result.url, published_at: new Date().toISOString(),
    tests: result.tests as CloudRun["tests"], ...withLog(run, line) };
  await writeRecord(input.viewerId, opened);
  return { url: result.url, tests: result.tests };
}
