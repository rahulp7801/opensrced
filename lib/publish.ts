// The publish gate's server half. A run ends with a frozen preview (see
// lib/pr-preview.ts); this opens the draft PR from exactly that preview,
// only when the owner explicitly confirms they read the change and can
// explain it, and only if every anti-slop guard still passes right now.

import { join } from "node:path";
import { createDraftPrFromLog, type PrResult } from "./agentic-pr";
import { aiBanReason, competingPrReason, openOpensrcerPrs, openPrsForIssue, prCaps, publishedInLastDay } from "./contrib-guard";
import { listAll, patch, read } from "./dispatch-store";
import { forgetFinished } from "./dispatcher";
import { readPreview } from "./pr-preview";
import { parseRunTarget } from "./run-target";
import { sanitizeLogValue } from "./sanitize";
import { appendFile } from "node:fs/promises";

export const CONFIRMATION = "I've read this change and can explain it to reviewers.";

/** Refusal with an HTTP status and a message safe to show the user. */
export class PublishError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export type PublishInput = {
  id: string;
  viewerId: string;
  confirmed: unknown;
  token: string | null;
  author: { login: string; id: number } | null;
  geminiKey?: string;
};

const DISPATCH_DIR = () => join(process.cwd(), ".dispatches");

/** Checks that need no network: ownership, state, confirmation, stored
 *  preview and its blockers. Exported for tests. */
export async function checkPublishable(input: Pick<PublishInput, "id" | "viewerId" | "confirmed">) {
  if (!/^d_[\w-]{1,80}$/.test(input.id)) throw new PublishError(404, "not found");
  const record = read(input.id);
  if (!record || record.auth0_user_id !== input.viewerId) throw new PublishError(404, "not found");
  if (record.dry_run) throw new PublishError(409, "This was a preview-only (dry) run. Start a live run to publish.");
  if (record.pr_status === "opened") throw new PublishError(409, "This run was already published.");
  if (record.pr_status === "pending") throw new PublishError(409, "Publishing is already in progress.");
  if (record.status !== "succeeded" || (record.pr_status !== "awaiting_review" && record.pr_status !== "failed")) {
    throw new PublishError(409, "There is no reviewed preview to publish for this run.");
  }
  if (input.confirmed !== true) throw new PublishError(400, `Confirm first: "${CONFIRMATION}"`);
  const stored = await readPreview(join(DISPATCH_DIR(), input.id));
  if (!stored) throw new PublishError(409, "The stored preview is missing; rerun the issue.");
  if (stored.preview.blockers.length) throw new PublishError(409, `Publishing is blocked: ${stored.preview.blockers.join("; ")}`);
  return { record, stored };
}

export async function publishDispatch(input: PublishInput): Promise<PrResult & { ok: true }> {
  const { record, stored } = await checkPublishable(input);
  if (!input.token || !input.author) throw new PublishError(401, "Sign in with GitHub again: the PR is opened from your account.");
  const repoFull = parseRunTarget(record.repo_url).repo;
  const issue = record.issue_number ?? 0;

  // Live guards: the world may have moved since the preview was made.
  const ban = stored.preview.profile ? aiBanReason(stored.preview.profile) : null;
  if (ban) throw new PublishError(409, `Refused: ${ban}.`);
  if (issue > 0) {
    let competing: string | null;
    try { competing = competingPrReason(await openPrsForIssue(repoFull, issue, input.token)); }
    catch { throw new PublishError(503, "Could not check for other open PRs on this issue. Try again."); }
    if (competing) throw new PublishError(409, `Refused: ${competing}`);
  }
  const caps = prCaps();
  let mine: string[];
  try { mine = await openOpensrcerPrs(repoFull, input.author.login, input.token); }
  catch { throw new PublishError(503, "Could not check your open PRs in this repository. Try again."); }
  if (mine.length >= caps.perRepo) throw new PublishError(429, `You already have ${mine.length} open opensrcer PR(s) in ${repoFull} (limit ${caps.perRepo}): ${mine[0]}. Land or close it first.`);
  const today = publishedInLastDay(listAll(input.viewerId).map((r) => r.published_at));
  if (today >= caps.daily) throw new PublishError(429, `Daily limit reached: ${today} PR(s) published in the last 24 hours (limit ${caps.daily}).`);

  patch(input.id, { pr_status: "pending" });
  forgetFinished(input.id);
  const logPath = record.log_path;
  await appendFile(logPath, `\n[publish] confirmed by the owner at ${new Date().toISOString()}: "${CONFIRMATION}"\n`).catch(() => {});
  let result: PrResult;
  try {
    result = await createDraftPrFromLog({
      repoFull, issueNumber: issue, logPath, dispatchId: input.id,
      findingId: record.finding_id, token: input.token, geminiKey: input.geminiKey, author: input.author, stored,
    });
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    await appendFile(logPath, `[publish] failed: ${sanitizeLogValue(result.reason)}\n`).catch(() => {});
    patch(input.id, { pr_status: "failed", pr_failure_reason: result.reason.slice(0, 500) });
    throw new PublishError(502, result.reason.slice(0, 500));
  }
  // The run page and enrichWithPrStatus key on this exact marker.
  await appendFile(logPath, `[agentic-pr] opened draft PR: ${sanitizeLogValue(result.url)}\n`).catch(() => {});
  patch(input.id, { pr_status: "opened", pr_url: result.url, tests: result.tests, published_at: new Date().toISOString() });
  return result;
}
