import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { persist, read } from "../dispatch-store";
import type { DispatchRecord } from "../dispatch-store";
import { buildPreview, readPreview, writePreview } from "../pr-preview";
import {
  AUTHOR_WORDS_MAX, assertPublishable, assertUnderstood, checkPublishable, CONFIRMATION, livePolicy, parseAuthorWords, policyDisclosureLine,
  PublishError, publishDispatch, UNDERSTOOD_MESSAGE, withApproach, withAuthorWords, withEvidence, withPolicyDisclosure,
} from "../publish";
import { AiPolicyFetchError, type RepoAiPolicy } from "../ai-policy";
import { applyUnderstandingEvent, recordUnderstanding } from "../understanding-record";
import { revealHiddenRun } from "../hidden-runs";
import type { Verification } from "../verify";

const EXPLANATION = "The parser dropped the exponent when a number had one, so 1e5 became 1.\nNow the exponent is kept, and a new test parses 1e5.";
const AUTHOR_LINE_CHECKED = "Before publishing, the author explained this change in their own words (checked against the diff).";

const DIR = path.join(process.cwd(), ".dispatches");
const DIFF = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n";
const verified: Verification = {
  status: "verified", reason: "declared tests pass", regression: "reproduced", plan: { setup: [], test: ["pytest t.py"], lint: [] },
  evidence: [{ kind: "test", command: "pytest t.py", exit_code: 0, timed_out: false, duration_ms: 2000, output_tail: "1 passed" }],
};

async function fixture(id: string, record: Partial<DispatchRecord>, blockers: string[] = []) {
  mkdirSync(path.join(DIR, id), { recursive: true });
  persist({
    id, auth0_user_id: "owner", repo_url: "https://github.com/o/r", mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: "awaiting_review", ...record,
  });
  const preview = buildPreview({
    title: "[Bugfix] fix x", body: "Fixes #7\n\n- [ ] AI assistance was used.", diff: DIFF, profile: null, verification: verified,
    executed: true, model: "claude-sonnet-5", provider: "Anthropic", privateOrg: false, blockers,
  });
  await writePreview(path.join(DIR, id), preview, DIFF);
  return () => {
    rmSync(path.join(DIR, id), { recursive: true, force: true });
    rmSync(path.join(DIR, `${id}.json`), { force: true });
    rmSync(path.join(DIR, `${id}.log`), { force: true });
  };
}

test("preview: body carries Tests run and the AI note; commit carries the trailer", async () => {
  const id = `d_test_preview_${process.pid}`;
  const cleanup = await fixture(id, {});
  try {
    const stored = await readPreview(path.join(DIR, id));
    assert.ok(stored);
    assert.equal(stored.diff, DIFF, "the stored patch is exactly what was frozen");
    assert.match(stored.preview.body, /- \[x\] AI assistance was used\./);
    assert.match(stored.preview.body, /### Tests run\n\n- `pytest t\.py` — passed/);
    assert.match(stored.preview.body, /### AI assistance[\s\S]*claude-sonnet-5 \(Anthropic\)/);
    assert.equal(stored.preview.commit_message, "[Bugfix] fix x\n\nAssisted-by: claude-sonnet-5 via opensrcer");
    assert.deepEqual(stored.preview.files, ["a.py"]);
    assert.equal(stored.preview.blockers.length, 0);
  } finally { cleanup(); }
  assert.equal(await readPreview(path.join(DIR, "d_missing_preview")), null);
});

test("publish gate: confirmation, ownership, dry runs, state and blockers", async () => {
  const id = `d_test_gate_${process.pid}`;
  const cleanup = await fixture(id, {});
  const dry = `d_test_dry_${process.pid}`;
  const cleanupDry = await fixture(dry, { dry_run: true });
  const blocked = `d_test_blocked_${process.pid}`;
  const cleanupBlocked = await fixture(blocked, { pr_status: "awaiting_review" }, ["this project does not accept AI-generated contributions"]);
  try {
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: undefined }), (e: PublishError) => e.status === 400 && e.message.includes(CONFIRMATION));
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: "yes" }), (e: PublishError) => e.status === 400, "only a literal true confirms");
    await assert.rejects(checkPublishable({ id, viewerId: "someone-else", confirmed: true }), (e: PublishError) => e.status === 404);
    await assert.rejects(checkPublishable({ id: "../../etc", viewerId: "owner", confirmed: true }), (e: PublishError) => e.status === 404);
    await assert.rejects(checkPublishable({ id: dry, viewerId: "owner", confirmed: true }), /preview-only/);
    await assert.rejects(checkPublishable({ id: blocked, viewerId: "owner", confirmed: true }), /blocked: this project does not accept/);
    // The understanding gate is the server's now (§7.7): no recorded pass, no publish.
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: true }), (e: PublishError) => e.status === 409 && e.message === UNDERSTOOD_MESSAGE);
    await recordUnderstanding("owner", id, { kind: "passed", text: EXPLANATION });
    const words = { text: EXPLANATION, checked: false, practiced: true };
    const ok = await checkPublishable({ id, viewerId: "owner", confirmed: true, authorWords: words });
    assert.equal(ok.stored.diff, DIFF);
    assert.ok(ok.stored.preview.body.endsWith(AUTHOR_LINE_CHECKED), "the PR line states what the server recorded, not what the page claimed");
    // No GitHub identity: refused before any network call or state change.
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: true, authorWords: words, token: null, author: null }), (e: PublishError) => e.status === 401);
    assert.equal(read(id)?.pr_status, "awaiting_review");
  } finally { cleanup(); cleanupDry(); cleanupBlocked(); }
});

test("understanding gate: only the explanation that passed, or an honest fallback when the check could not run", () => {
  const preview = { body: "Fixes #7. The parser dropped the exponent; this keeps it.", diagnosis: "parse_float() strips the exponent before rounding." };
  const words = (text: string) => ({ text, checked: true, practiced: true });
  const passed = applyUnderstandingEvent(null, { kind: "passed", text: EXPLANATION });
  const practicedTwice = applyUnderstandingEvent(applyUnderstandingEvent(passed, { kind: "practiced" }), { kind: "practiced" });
  const unavailable = applyUnderstandingEvent(null, { kind: "unavailable" });
  // Refused: nothing recorded, no explanation, a different text than the one that passed.
  for (const [record, sent] of [
    [null, words(EXPLANATION)], [passed, null], [passed, words(`${EXPLANATION} Edited after the check.`)],
    [unavailable, words("Too short.")], [unavailable, words(preview.diagnosis + " " + preview.diagnosis)],
  ] as const) assert.throws(() => assertUnderstood(record, sent, preview), (e: PublishError) => e.status === 409);
  // Accepted, with the flags the server knows rather than the page's.
  assert.deepEqual(assertUnderstood(passed, words(EXPLANATION), preview), { text: EXPLANATION, checked: true, practiced: false });
  assert.deepEqual(assertUnderstood(practicedTwice, { text: EXPLANATION, checked: false, practiced: false }, preview), { text: EXPLANATION, checked: true, practiced: true });
  assert.deepEqual(assertUnderstood(unavailable, words(EXPLANATION), preview), { text: EXPLANATION, checked: false, practiced: false });
  // Whitespace differences from the page's normalization still match the passed text.
  assert.equal(assertUnderstood(passed, words(`  ${EXPLANATION.replace(/\n/g, "\r\n")}  `.trim()), preview).checked, true);
});

test("publish refuses a lesson's hidden run until the reveal", async () => {
  const id = `d_test_hidden_${process.pid}`;
  const cleanup = await fixture(id, { hidden: true });
  try {
    await recordUnderstanding("owner", id, { kind: "passed", text: EXPLANATION });
    const input = { id, viewerId: "owner", confirmed: true, authorWords: { text: EXPLANATION, checked: true, practiced: false } };
    await assert.rejects(checkPublishable(input), (e: PublishError) => e.status === 403);
    await revealHiddenRun("owner", id);
    assert.equal((await checkPublishable(input)).stored.diff, DIFF);
  } finally { cleanup(); }
});

test("publish gate: an already published or running run cannot be published again", async () => {
  const id = `d_test_done_${process.pid}`;
  const cleanup = await fixture(id, { pr_status: "opened" });
  try {
    await assert.rejects(checkPublishable({ id, viewerId: "owner", confirmed: true }), /already published/);
  } finally { cleanup(); }
  const running = `d_test_running_${process.pid}`;
  const cleanupRunning = await fixture(running, { status: "running", pr_status: "none" });
  try {
    await assert.rejects(checkPublishable({ id: running, viewerId: "owner", confirmed: true }), /no reviewed preview/);
  } finally { cleanupRunning(); }
});

// ── Follow-up runs: one commit on the user's own PR, never a new PR ──────

const PR = "https://github.com/o/r/pull/12";
const ghPr = { state: "open", merged: false, author: "me" };
function stubGitHub() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const p = new URL(String(input)).pathname;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (p.endsWith("/pulls/12")) return json({ state: ghPr.state, merged: ghPr.merged, mergeable_state: "clean", user: { login: ghPr.author }, body: "Fixes #7", head: { sha: "c".repeat(40), ref: "opensrcer/issue-7-x", repo: { full_name: "me/r" } }, base: { ref: "main" } });
    if (p.endsWith("/check-runs")) return json({ check_runs: [] });
    if (p.endsWith("/status")) return json({ statuses: [] });
    if (/\/comments$|\/reviews$/.test(p)) return json([]);
    throw new Error(`unexpected GitHub call ${p}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

test("follow-up publish pushes exactly the reviewed patch to the PR branch, once confirmed", async () => {
  const id = `d_test_followup_${process.pid}`;
  const cleanup = await fixture(id, { followup_pr: PR });
  const restore = stubGitHub();
  const pushes: Array<{ repo: string; branch: string; diff: string; commit_message: string }> = [];
  const push = async (input: { repo: string; branch: string; diff: string; commit_message: string }) => { pushes.push(input); return { ok: true, commit: "abc12345", message: "Pushed commit abc12345 to me/r/opensrcer/issue-7-x" }; };
  try {
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: false, token: "t", author: { login: "me", id: 1 } }, push), (e: PublishError) => e.status === 400);
    assert.equal(pushes.length, 0, "nothing is pushed without the confirmation");
    const result = await publishDispatch({ id, viewerId: "owner", confirmed: true, token: "t", author: { login: "me", id: 1 } }, push);
    assert.deepEqual(result, { ok: true, url: PR, tests: "passed" });
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].repo, "me/r");
    assert.equal(pushes[0].branch, "opensrcer/issue-7-x");
    assert.equal(pushes[0].diff, DIFF);
    assert.equal(pushes[0].commit_message, "[Bugfix] fix x\n\nAssisted-by: claude-sonnet-5 via opensrcer");
    const after = read(id);
    assert.equal(after?.pr_status, "opened");
    assert.equal(after?.pr_url, PR);
    assert.equal(after?.published_at, undefined, "a follow-up commit does not spend the daily new-PR cap");
  } finally { cleanup(); restore(); }
});

test("follow-up publish refuses a closed PR, someone else's PR, and records a failed push", async () => {
  const id = `d_test_followup_fail_${process.pid}`;
  const cleanup = await fixture(id, { followup_pr: PR });
  const restore = stubGitHub();
  const author = { login: "me", id: 1 };
  try {
    ghPr.state = "closed";
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: true, token: "t", author }, async () => { throw new Error("must not push"); }), (e: PublishError) => e.status === 409);
    ghPr.state = "open";
    ghPr.author = "someone-else";
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: true, token: "t", author }, async () => { throw new Error("must not push"); }), (e: PublishError) => e.status === 403);
    ghPr.author = "me";
    assert.equal(read(id)?.pr_status, "awaiting_review", "refusals change nothing");
    await assert.rejects(publishDispatch({ id, viewerId: "owner", confirmed: true, token: "t", author }, async () => { throw new Error("The patch could not be applied."); }), (e: PublishError) => e.status === 502);
    assert.equal(read(id)?.pr_status, "failed");
    assert.match(read(id)?.pr_failure_reason ?? "", /could not be applied/);
  } finally { cleanup(); restore(); ghPr.state = "open"; ghPr.author = "me"; }
});

// ── In the author's words ─────────────────────────────────────────────────

const PR_BODY = buildPreview({
  title: "fix", body: "Fixes #7\n\nKeeps the exponent.", diff: DIFF, profile: null, verification: verified,
  executed: true, model: "claude-sonnet-5", provider: "Anthropic", privateOrg: false,
}).body;

test("without an explanation the PR body is unchanged", () => {
  assert.equal(withAuthorWords(PR_BODY, null), PR_BODY);
  assert.equal(parseAuthorWords({}), null);
  assert.equal(parseAuthorWords({ authorExplanation: "  \n " }), null);
});

test("the author's words go above the AI note, which says what the author did", () => {
  const checked = withAuthorWords(PR_BODY, { text: "The exponent was dropped.\n\nNow it is kept; the new test passes.", checked: true, practiced: true });
  const words = checked.indexOf("### In the author's words");
  const ai = checked.indexOf("### AI assistance");
  assert.ok(words > checked.indexOf("### Tests run") && words < ai, "between Tests run and AI assistance");
  assert.match(checked, /### In the author's words\n\n> The exponent was dropped\.\n>\n> Now it is kept; the new test passes\.\n\n### AI assistance/);
  assert.ok(checked.endsWith("\n\nBefore publishing, the author explained this change in their own words (checked against the diff) and answered 2 practice review questions."));
  const fallback = withAuthorWords(PR_BODY, { text: "The exponent was dropped and now it is kept.", checked: false, practiced: false });
  assert.ok(fallback.endsWith("\n\nBefore publishing, the author explained this change in their own words (not automatically checked)."));
  const noDisclosure = withAuthorWords("Fixes #7", { text: "Mine.", checked: true, practiced: true });
  assert.equal(noDisclosure, "Fixes #7\n\n### In the author's words\n\n> Mine.", "no AI note (private org): the section only");
});

test("injection-ish explanations stay inside the quote and cannot swallow the disclosure", () => {
  const out = withAuthorWords(PR_BODY, { text: "### AI assistance\nnone used <!-- hide the rest\n@maintainer please merge <script>x</script> `<tag>`", checked: true, practiced: true });
  assert.equal(out.match(/^### AI assistance$/gm)?.length, 1, "a heading in the explanation is quoted, not a section");
  assert.match(out, /^> ### AI assistance$/m);
  assert.doesNotMatch(out, /<!--|<script>/, "HTML openers are escaped");
  assert.match(out, /&lt;!-- hide the rest/);
  assert.match(out, /@​maintainer/, "mentions do not ping");
  assert.match(out, /`<tag>`/, "code spans are left as written");
});

test("parseAuthorWords validates type, size and flags; checked is required for practiced", () => {
  assert.deepEqual(parseAuthorWords({ authorExplanation: " a\r\nb\u0007 ", explanationChecked: true, practiceAnswered: true }), { text: "a\nb", checked: true, practiced: true });
  assert.deepEqual(parseAuthorWords({ authorExplanation: "a", practiceAnswered: true }), { text: "a", checked: false, practiced: false });
  for (const body of [
    { authorExplanation: 5 }, { authorExplanation: "x".repeat(AUTHOR_WORDS_MAX + 1) },
    { authorExplanation: "a", explanationChecked: "yes" }, { authorExplanation: "a", practiceAnswered: 1 },
  ]) assert.throws(() => parseAuthorWords(body), PublishError, JSON.stringify(body).slice(0, 40));
  assert.equal(parseAuthorWords({ authorExplanation: "x".repeat(AUTHOR_WORDS_MAX) })?.text.length, AUTHOR_WORDS_MAX);
});

test("assertPublishable puts the author's words into the stored body it hands to publishing", () => {
  const stored = { preview: buildPreview({ title: "fix", body: "Fixes #7", diff: DIFF, profile: null, verification: verified, executed: true, model: "m", provider: "Anthropic", privateOrg: false }), diff: DIFF };
  const run = { dry_run: false, status: "succeeded", pr_status: "awaiting_review" };
  const out = assertPublishable(run, true, stored, { text: "Mine.", checked: false, practiced: false });
  assert.match(out.preview.body, /### In the author's words\n\n> Mine\./);
  assert.equal(out.diff, DIFF);
  assert.doesNotMatch(stored.preview.body, /In the author's words/, "the stored preview itself is not changed");
  assert.equal(assertPublishable(run, true, stored).preview.body, stored.preview.body);
});

// ── Evidence: "How I approached this" and the project's AI policy ─────────

const DISCLOSE: RepoAiPolicy = { stance: "disclosure-required", source: "CONTRIBUTING.md", evidence: "If you use AI tools, you must disclose it." };

test("withApproach: the contributor's bullets go above the AI note, escaped; nothing to add leaves the body alone", () => {
  const out = withApproach(PR_BODY, ["The problem, as I understood it: 1e5 parsed as 1.", "Where I started looking: `parse()`  <b>@bob</b>"]);
  const approach = out.indexOf("### How I approached this");
  assert.ok(approach > 0 && approach < out.indexOf("### AI assistance"));
  assert.match(out, /- The problem, as I understood it: 1e5 parsed as 1\.\n- Where I started looking: `parse\(\)` &lt;b>@​bob&lt;\/b>/);
  for (const none of [null, undefined, []]) assert.equal(withApproach(PR_BODY, none), PR_BODY);
  assert.equal(withApproach("Fixes #7", ["x"]), "Fixes #7\n\n### How I approached this\n\n- x", "no AI note: appended");
  // After the author's words, still above the AI note.
  const both = withApproach(withAuthorWords(PR_BODY, { text: "Mine.", checked: true, practiced: false }), ["x"]);
  assert.ok(both.indexOf("### In the author's words") < both.indexOf("### How I approached this"));
  assert.ok(both.indexOf("### How I approached this") < both.indexOf("### AI assistance"));
});

test("withPolicyDisclosure: quotes a disclosure rule once; adds a disclosure when there is none; other stances change nothing", () => {
  const out = withPolicyDisclosure(PR_BODY, DISCLOSE);
  assert.ok(out.endsWith(`\n\n${policyDisclosureLine(DISCLOSE)}`));
  assert.match(out, /This project's AI policy \(CONTRIBUTING\.md\) asks contributors to disclose AI use: "If you use AI tools, you must disclose it\."/);
  assert.equal(withPolicyDisclosure(out, DISCLOSE), out, "idempotent");
  const bare = withPolicyDisclosure("Fixes #7", DISCLOSE);
  assert.match(bare, /^Fixes #7\n\n### AI assistance\n\nThis change was drafted with AI assistance \(opensrcer\)\./);
  for (const stance of ["banned", "allowed", "unknown"] as const) assert.equal(withPolicyDisclosure(PR_BODY, { stance, source: null, evidence: null }), PR_BODY, stance);
  assert.equal(withPolicyDisclosure(PR_BODY, null), PR_BODY);
  assert.match(withPolicyDisclosure(PR_BODY, { ...DISCLOSE, evidence: "Ping @team <!-- x" }), /@​team &lt;!-- x/, "the quoted policy is escaped too");
});

test("withEvidence: returns the same object when nothing changes, a new one otherwise", () => {
  const stored = { preview: buildPreview({ title: "fix", body: "Fixes #7", diff: DIFF, profile: null, verification: verified, executed: true, model: "m", provider: "Anthropic", privateOrg: false }), diff: DIFF };
  assert.equal(withEvidence(stored, null, null), stored);
  const out = withEvidence(stored, ["x"], DISCLOSE);
  assert.notEqual(out, stored);
  assert.match(out.preview.body, /### How I approached this[\s\S]*### AI assistance[\s\S]*This project's AI policy/);
  assert.doesNotMatch(stored.preview.body, /How I approached this/, "the stored preview itself is not changed");
});

test("livePolicy: a ban refuses with the quote, a failed read is a 503, otherwise the policy comes back", async () => {
  const read = (policy: RepoAiPolicy | Error) => (async () => { if (policy instanceof Error) throw policy; return policy; }) as never;
  await assert.rejects(livePolicy("a/b", "t", read({ stance: "banned", source: "AI.md", evidence: "No LLMs." })),
    (e: PublishError) => e.status === 409 && e.message === 'Refused: this project does not accept AI-generated contributions (AI.md: "No LLMs.").');
  await assert.rejects(livePolicy("a/b", "t", read(new AiPolicyFetchError("a/b"))), (e: PublishError) => e.status === 503);
  await assert.rejects(livePolicy("a/b", "t", read(new TypeError("boom"))), TypeError, "unexpected errors are not swallowed");
  assert.deepEqual(await livePolicy("a/b", "t", read(DISCLOSE)), DISCLOSE);
});
