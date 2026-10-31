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
import { HIDDEN_RUN_MESSAGE, hiddenRunLocked } from "./hidden-runs";
import { looksCopied, OWN_WORDS } from "./understanding";
import { explanationSha, normalizeExplanation, readUnderstanding, type UnderstandingRecord } from "./understanding-record";
import { AiPolicyFetchError, aiPolicyBanReason, repoAiPolicy, type RepoAiPolicy } from "./ai-policy";
import { gh } from "./gh";
import type { Level } from "./record/levels";
import { capsLevelFor } from "./record/standing";

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
// maintainers above the AI-assistance note. The page sends `checked` and
// `practiced`, but publishing replaces them with what the server recorded
// (assertUnderstood), so the PR line states only what really happened.

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
  const text = normalizeExplanation(raw);
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
  const safe = safeBodyText(words.text);
  const section = `### In the author's words\n\n${safe.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}`;
  const marker = body.lastIndexOf(AI_SECTION);
  if (marker < 0) return `${body}\n\n${section}`;
  const line = words.practiced ? AUTHOR_LINE.practiced : words.checked ? AUTHOR_LINE.checked : AUTHOR_LINE.unchecked;
  return `${body.slice(0, marker)}\n\n${section}\n${body.slice(marker)}\n\n${line}`;
}

const AI_SECTION = "\n### AI assistance\n";

/** Text someone else wrote, made safe for the PR body: mentions defused and
 *  HTML openers escaped outside code. */
function safeBodyText(text: string): string {
  return neutralizeMentions(text)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/</g, "&lt;")))
    .join("");
}

// ── How I approached this ─────────────────────────────────────────────────
// Evidence for maintainers vetting a contributor: a few bullets built only
// from the contributor's own lesson answers (lib/lesson/approach.ts), never
// the AI's text. Opt-in on the publish screen (on by default) and shown in
// the preview first. Placed above the AI-assistance section, like the
// author's words.

export function withApproach(body: string, bullets: string[] | null | undefined): string {
  if (!bullets?.length) return body;
  // ponytail: a link to the contributor's opensrcer profile goes here once /u/<login> exists (PLAN §9.5).
  const section = `### How I approached this\n\n${bullets.map((b) => `- ${safeBodyText(b.replace(/\s+/g, " ").trim())}`).join("\n")}`;
  const marker = body.lastIndexOf(AI_SECTION);
  return marker < 0 ? `${body}\n\n${section}` : `${body.slice(0, marker)}\n\n${section}\n${body.slice(marker)}`;
}

// ── The project's AI policy ───────────────────────────────────────────────
// A project that requires disclosure (lib/ai-policy.ts) gets its own rule
// quoted next to the disclosure, so a maintainer sees it was followed. The
// standard disclosure is added if the body has none (private-org runs may
// turn it off; a project's rule overrides that).

const STANDARD_DISCLOSURE = "This change was drafted with AI assistance (opensrcer). The PR author reviewed it before opening this PR and is responsible for it.";

export function policyDisclosureLine(policy: RepoAiPolicy): string {
  return `This project's AI policy (${policy.source}) asks contributors to disclose AI use: "${safeBodyText(policy.evidence ?? "")}" The "AI assistance" section is that disclosure.`;
}

export function withPolicyDisclosure(body: string, policy: RepoAiPolicy | null | undefined): string {
  if (policy?.stance !== "disclosure-required") return body;
  const line = policyDisclosureLine(policy);
  if (body.includes(line)) return body;
  return body.includes(AI_SECTION) ? `${body}\n\n${line}` : `${body}\n\n### AI assistance\n\n${STANDARD_DISCLOSURE}\n\n${line}`;
}

/** The PR body as it will be sent: the approach bullets (when the author
 *  kept them) and the policy's disclosure. The preview shows the same. */
export function withEvidence(stored: StoredPreview, approach: string[] | null | undefined, policy: RepoAiPolicy | null | undefined): StoredPreview {
  const body = withPolicyDisclosure(withApproach(stored.preview.body, approach), policy);
  return body === stored.preview.body ? stored : { ...stored, preview: { ...stored.preview, body } };
}

export type PublishInput = {
  id: string;
  viewerId: string;
  confirmed: unknown;
  /** The author's own explanation (parseAuthorWords), for the PR body. */
  authorWords?: AuthorWords | null;
  /** "How I approached this" bullets from the run's lesson (lib/lesson/approach.ts), when the author kept them. */
  approach?: string[] | null;
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
  return withWords(stored, authorWords);
}

/** The stored preview with the author's words in its body. */
export function withWords(stored: StoredPreview, words: AuthorWords | null): StoredPreview {
  return words ? { ...stored, preview: { ...stored.preview, body: withAuthorWords(stored.preview.body, words) } } : stored;
}

export const UNDERSTOOD_MESSAGE = "Explain the change in your own words and pass the check before publishing. The explanation you publish must be the one that passed.";

/** The server-enforced understanding gate (PLAN §7.7). Publishing needs the
 *  explanation that passed /api/understand for this run, or, when the check
 *  could not run (no key, provider outage), an explanation that is long
 *  enough and not copied from the AI's own text: the same fallback the page
 *  has always allowed, now decided here. Returns the words with `checked`
 *  and `practiced` taken from the record, not from the page. */
export function assertUnderstood(record: UnderstandingRecord | null, words: AuthorWords | null, preview: Pick<PrPreview, "body" | "diagnosis">): AuthorWords {
  if (!words) throw new PublishError(409, UNDERSTOOD_MESSAGE);
  if (record?.passed_sha && record.passed_sha === explanationSha(words.text)) {
    return { text: words.text, checked: true, practiced: record.practiced >= 2 };
  }
  if (record?.unavailable_at && words.text.length >= OWN_WORDS.min && !looksCopied(words.text, [preview.diagnosis ?? "", preview.body])) {
    return { text: words.text, checked: false, practiced: false };
  }
  throw new PublishError(409, UNDERSTOOD_MESSAGE);
}

/** The project's AI policy now (cached, lib/ai-policy.ts), or the refusal. */
export async function livePolicy(repoFull: string, token: string, read: typeof repoAiPolicy = repoAiPolicy): Promise<RepoAiPolicy> {
  let policy: RepoAiPolicy;
  try { policy = await read(gh(token), repoFull); }
  catch (error) {
    if (error instanceof AiPolicyFetchError) throw new PublishError(503, `${error.message} Try again.`);
    throw error;
  }
  const ban = aiPolicyBanReason(policy);
  if (ban) throw new PublishError(409, `Refused: ${ban}.`);
  return policy;
}

/** Guards re-checked against GitHub at publish time: the world may have
 *  moved since the preview was made. Returns the project's AI policy, for
 *  the disclosure (withEvidence). `level` sets the PR caps (capsLevelFor). */
export async function liveGuards(opts: {
  repoFull: string; issue: number; token: string; login: string; preview: PrPreview; publishedAt: Array<string | undefined>; level?: Level;
}): Promise<RepoAiPolicy> {
  const ban = opts.preview.profile ? aiBanReason(opts.preview.profile) : null;
  if (ban) throw new PublishError(409, `Refused: ${ban}.`);
  // The policy files as they are now, AI.md and AI_POLICY.md included.
  const policy = await livePolicy(opts.repoFull, opts.token);
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
  const caps = prCaps(opts.level);
  let mine: string[];
  try { mine = await openOpensrcerPrs(opts.repoFull, opts.login, opts.token); }
  catch { throw new PublishError(503, "Could not check your open PRs in this repository. Try again."); }
  if (mine.length >= caps.perRepo) throw new PublishError(429, `You already have ${mine.length} open opensrcer PR(s) in ${opts.repoFull} (limit ${caps.perRepo}): ${mine[0]}. Land or close it first.`);
  const today = publishedInLastDay(opts.publishedAt);
  if (today >= caps.daily) throw new PublishError(429, `Daily limit reached: ${today} PR(s) published in the last 24 hours (limit ${caps.daily}).`);
  return policy;
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
  if (await hiddenRunLocked(input.viewerId, record)) throw new PublishError(403, HIDDEN_RUN_MESSAGE);
  const checked = assertPublishable(record, input.confirmed, await readPreview(join(DISPATCH_DIR(), input.id)));
  // A follow-up adds one commit with no PR text, so the page asks for no explanation.
  const words = record.followup_pr ? input.authorWords ?? null
    : assertUnderstood(await readUnderstanding(input.viewerId, input.id), input.authorWords ?? null, checked.preview);
  return { record, stored: withWords(checked, words) };
}

/** `push` is replaceable in tests (follow-up runs only). */
export async function publishDispatch(input: PublishInput, push: typeof pushPrPatch = pushPrPatch): Promise<Published> {
  const { record, stored: checked } = await checkPublishable(input);
  if (!input.token || !input.author) throw new PublishError(401, "Sign in with GitHub again: the PR is opened from your account.");
  if (record.followup_pr) return publishLocalFollowup({ ...input, token: input.token, author: input.author }, record, checked, push);
  const repoFull = record.repo_url.replace(/^https:\/\/github\.com\//, "");
  const issue = record.issue_number ?? 0;
  const policy = await liveGuards({ repoFull, issue, token: input.token, login: input.author.login, preview: checked.preview,
    publishedAt: listAll(input.viewerId).map((r) => r.published_at), level: await capsLevelFor(input.viewerId) });
  const stored = withEvidence(checked, input.approach, policy);

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
