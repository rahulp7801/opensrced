// The publish gate's server half. A run ends with a frozen preview (see
// lib/pr-preview.ts); this opens the draft PR from exactly that preview,
// only when the owner explicitly confirms they read the change and can
// explain it, and only if every anti-slop guard still passes right now.
// Local runs publish here; hosted runs share the checks and publish through
// a push VM (lib/cloud-publish.ts).

import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { createDraftPrFromLog, neutralizeMentions, type PrResult } from "./agentic-pr";
import { aiBanReason, competingPrReason, issueTimeline, orgAiBanReason, maintainerAiObjection, maintainerObjectionReason, openOpensrcerPrs, openPrsFromTimeline, prCaps, publishedInLastDay, type TimelineEvent } from "./contrib-guard";
import { listAll, patch, read } from "./dispatch-store";
import { forgetFinished } from "./dispatcher";
import { readPreview, type PrPreview } from "./pr-preview";
import { sanitizeLogValue } from "./sanitize";
import { parseGitHubPullUrl } from "./github-pull-url";
import { fetchSnapshot } from "./pr-lifecycle";
import { pushPrPatch } from "./pr-push";
import { testOutcome } from "./verify";

/** What a successful publish returns: the PR (new, or updated by a follow-up). */
export type Published = { ok: true; url: string; tests: "passed" | "failed" | "skipped" | "not_run" };

export const CONFIRMATION = "I've read this change and can explain it to reviewers.";

/** Refusal with an HTTP status and a message safe to show the user. */
export class PublishError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PublishError";
  }
}

// ── In the author's words ────────────────────────────────────────────────
// The contributor's own explanation from the review screen, shown to
// maintainers above the AI-assistance note. `checked` and `practiced` are
// what the page reports: its gate is a comprehension aid, not a security
// control, so the PR line states only what the author went through.

export const AUTHOR_WORDS_MAX = 2000;
export type AuthorWords = { text: string; checked: boolean; practiced: boolean };

const AUTHOR_LINE = {
  practiced: "Before publishing, the author explained this change in their own words (checked against the diff) and answered 2 practice review questions.",
  checked: "Before publishing, the author explained this change in their own words (checked against the diff).",
  unchecked: "Before publishing, the author explained this change in their own words (not automatically checked).",
};

/** The optional publish fields: authorExplanation (text), explanationChecked
 *  and practiceAnswered (booleans). Null when no explanation was sent. */
export function parseAuthorWords(body: Record<string, unknown>): AuthorWords | null {
  const raw = body.authorExplanation;
  if (raw == null) return null;
  if (typeof raw !== "string") throw new PublishError(400, "authorExplanation must be text.");
  for (const flag of ["explanationChecked", "practiceAnswered"] as const) {
    if (body[flag] != null && typeof body[flag] !== "boolean") throw new PublishError(400, `${flag} must be true or false.`);
  }
  const text = raw.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  if (text.length > AUTHOR_WORDS_MAX) throw new PublishError(400, `Keep your explanation under ${AUTHOR_WORDS_MAX} characters.`);
  const checked = body.explanationChecked === true;
  return { text, checked, practiced: checked && body.practiceAnswered === true };
}

/** The PR body with "In the author's words" above the AI-assistance section
 *  and one line in that section saying what the author did. The text is a
 *  blockquote (its headings cannot pose as the PR's own sections), with
 *  mentions defused and HTML openers escaped outside code (an unclosed
 *  `<!--` cannot swallow the disclosure section below it). */
export function withAuthorWords(body: string, words: AuthorWords | null): string {
  if (!words) return body;
  const safe = neutralizeMentions(words.text)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/</g, "&lt;")))
    .join("");
  const section = `### In the author's words\n\n${safe.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}`;
  const marker = body.lastIndexOf("\n### AI assistance\n");
  if (marker < 0) return `${body}\n\n${section}`;
  const line = words.practiced ? AUTHOR_LINE.practiced : words.checked ? AUTHOR_LINE.checked : AUTHOR_LINE.unchecked;
  return `${body.slice(0, marker)}\n\n${section}\n${body.slice(marker)}\n\n${line}`;
}

export type PublishInput = {
  id: string;
  viewerId: string;
  confirmed: unknown;
  /** The author's own explanation (parseAuthorWords), for the PR body. */
  authorWords?: AuthorWords | null;
  token: string | null;
  author: { login: string; id: number } | null;
  geminiKey?: string;
};

export type StoredPreview = { preview: PrPreview; diff: string };

type PublishTarget = { dry_run: boolean; status: string; pr_status?: string };

/** State, confirmation and blockers: the checks shared by local and hosted
 *  runs. Exported for tests. */
export function assertPublishable(run: PublishTarget, confirmed: unknown, stored: StoredPreview | null, authorWords: AuthorWords | null = null): StoredPreview {
  if (run.dry_run) throw new PublishError(409, "This was a preview-only (dry) run. Start a live run to publish.");
  if (run.pr_status === "opened") throw new PublishError(409, "This run was already published.");
  if (run.pr_status === "pending") throw new PublishError(409, "Publishing is already in progress.");
  if (run.status !== "succeeded" || (run.pr_status !== "awaiting_review" && run.pr_status !== "failed")) {
    throw new PublishError(409, "There is no reviewed preview to publish for this run.");
  }
  if (confirmed !== true) throw new PublishError(400, `Confirm first: "${CONFIRMATION}"`);
  if (!stored) throw new PublishError(409, "The stored preview is missing; rerun the issue.");
  if (stored.preview.blockers.length) throw new PublishError(409, `Publishing is blocked: ${stored.preview.blockers.join("; ")}`);
  return authorWords ? { ...stored, preview: { ...stored.preview, body: withAuthorWords(stored.preview.body, authorWords) } } : stored;
}

/** Guards re-checked against GitHub at publish time: the world may have
 *  moved since the preview was made. */
export async function liveGuards(opts: {
  repoFull: string; issue: number; token: string; login: string; preview: PrPreview; publishedAt: Array<string | undefined>;
}): Promise<void> {
  const ban = opts.preview.profile ? aiBanReason(opts.preview.profile) : null;
  if (ban) throw new PublishError(409, `Refused: ${ban}.`);
  // A project that states no AI policy of its own falls under its organization's default guide.
  if (!opts.preview.profile || opts.preview.profile.aiPolicy.stance === "unknown") {
    const orgBan = await orgAiBanReason(opts.repoFull, opts.token);
    if (orgBan) throw new PublishError(409, `Refused: ${orgBan}.`);
  }
  if (opts.issue > 0) {
    let events: TimelineEvent[];
    try { events = await issueTimeline(opts.repoFull, opts.issue, opts.token); }
    catch { throw new PublishError(503, "Could not check this issue's open PRs and maintainer comments. Try again."); }
    const objection = maintainerObjectionReason(maintainerAiObjection(events));
    if (objection) throw new PublishError(409, `Refused: ${objection}.`);
    const competing = competingPrReason(openPrsFromTimeline(events));
    if (competing) throw new PublishError(409, `Refused: ${competing}`);
  }
  const caps = prCaps();
  let mine: string[];
  try { mine = await openOpensrcerPrs(opts.repoFull, opts.login, opts.token); }
  catch { throw new PublishError(503, "Could not check your open PRs in this repository. Try again."); }
  if (mine.length >= caps.perRepo) throw new PublishError(429, `You already have ${mine.length} open opensrcer PR(s) in ${opts.repoFull} (limit ${caps.perRepo}): ${mine[0]}. Land or close it first.`);
  const today = publishedInLastDay(opts.publishedAt);
  if (today >= caps.daily) throw new PublishError(429, `Daily limit reached: ${today} PR(s) published in the last 24 hours (limit ${caps.daily}).`);
}

/** Where a published follow-up goes (runs with `followup_pr`): the PR's
 *  branch, re-read from GitHub now, never from a run record. Refuses a PR that
 *  is closed or not the publisher's own. Exported for hosted publishing. */
export async function followupPushTarget(prUrl: string, token: string, login: string): Promise<{ repo: string; branch: string; url: string }> {
  const target = parseGitHubPullUrl(prUrl);
  if (!target) throw new PublishError(409, "This follow-up names no valid pull request.");
  let snapshot: Awaited<ReturnType<typeof fetchSnapshot>>;
  try { snapshot = await fetchSnapshot({ repo: target.repoFull, number: target.prNumber }, token); }
  catch { throw new PublishError(503, "Could not read the pull request from GitHub. Try again."); }
  if (snapshot.state !== "open" || snapshot.merged) throw new PublishError(409, "The pull request is no longer open; nothing was pushed.");
  if (snapshot.author.toLowerCase() !== login.toLowerCase()) throw new PublishError(403, "Follow-ups are pushed only to your own pull requests.");
  if (!snapshot.head_repo) throw new PublishError(409, "The pull request's branch no longer exists.");
  return { repo: snapshot.head_repo, branch: snapshot.head_ref, url: target.url };
}

/** Follow-ups skip the new-PR guards (caps, competing PRs: the PR is the
 *  user's own) but keep the repository's AI-policy refusal. */
export function followupGuards(preview: PrPreview): void {
  const ban = preview.profile ? aiBanReason(preview.profile) : null;
  if (ban) throw new PublishError(409, `Refused: ${ban}.`);
}

const DISPATCH_DIR = () => join(process.cwd(), ".dispatches");

/** Local run lookup plus the shared checks. Exported for tests. */
export async function checkPublishable(input: Pick<PublishInput, "id" | "viewerId" | "confirmed" | "authorWords">) {
  if (!/^d_[\w-]{1,80}$/.test(input.id)) throw new PublishError(404, "not found");
  const record = read(input.id);
  if (!record || record.auth0_user_id !== input.viewerId) throw new PublishError(404, "not found");
  const stored = assertPublishable(record, input.confirmed, await readPreview(join(DISPATCH_DIR(), input.id)), input.authorWords ?? null);
  return { record, stored };
}

/** `push` is replaceable in tests (follow-up runs only). */
export async function publishDispatch(input: PublishInput, push: typeof pushPrPatch = pushPrPatch): Promise<Published> {
  const { record, stored } = await checkPublishable(input);
  if (!input.token || !input.author) throw new PublishError(401, "Sign in with GitHub again: the PR is opened from your account.");
  if (record.followup_pr) return publishLocalFollowup({ ...input, token: input.token, author: input.author }, record, stored, push);
  const repoFull = record.repo_url.replace(/^https:\/\/github\.com\//, "");
  const issue = record.issue_number ?? 0;
  await liveGuards({ repoFull, issue, token: input.token, login: input.author.login, preview: stored.preview, publishedAt: listAll(input.viewerId).map((r) => r.published_at) });

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

/** A follow-up run's publish: one commit with exactly the reviewed patch,
 *  pushed to the user's own open PR branch (a normal push, so a branch that
 *  moved meanwhile rejects it). No new PR; published_at stays unset so the
 *  daily new-PR cap is not spent. */
async function publishLocalFollowup(
  input: PublishInput & { token: string; author: { login: string; id: number } },
  record: NonNullable<ReturnType<typeof read>>,
  stored: StoredPreview,
  push: typeof pushPrPatch,
): Promise<Published> {
  followupGuards(stored.preview);
  const target = await followupPushTarget(record.followup_pr!, input.token, input.author.login);
  patch(input.id, { pr_status: "pending" });
  forgetFinished(input.id);
  await appendFile(record.log_path, `\n[publish] confirmed by the owner at ${new Date().toISOString()}: "${CONFIRMATION}"\n`).catch(() => {});
  try {
    const pushed = await push({ repo: target.repo, branch: target.branch, diff: stored.diff, commit_message: stored.preview.commit_message, author: input.author }, input.token);
    await appendFile(record.log_path, `[publish] ${sanitizeLogValue(pushed.message)} (follow-up to ${target.url})\n`).catch(() => {});
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await appendFile(record.log_path, `[publish] failed: ${sanitizeLogValue(reason)}\n`).catch(() => {});
    patch(input.id, { pr_status: "failed", pr_failure_reason: reason.slice(0, 500) });
    throw new PublishError(502, reason.slice(0, 500));
  }
  const tests = testOutcome(stored.preview.executed ? stored.preview.verification : null);
  patch(input.id, { pr_status: "opened", pr_url: target.url, tests });
  return { ok: true, url: target.url, tests };
}
