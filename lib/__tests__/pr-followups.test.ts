import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { persist } from "../dispatch-store";
import type { StartAgenticOpts } from "../agentic-dispatcher";
import { FollowupError, followupView, ownedPr, pollFollowups, setFollowupOptIn, startFollowupRun } from "../pr-followups";
import { initialState, type PrSnapshot } from "../pr-lifecycle";

// Local mode: records in .dispatches/, lifecycle state in .dispatches/lifecycle/.
delete process.env.OPENSRCER_EXECUTION;
delete process.env.VERCEL;

const DIR = path.join(process.cwd(), ".dispatches");
const OWNER = `followup-owner-${process.pid}`;
const REPO = `acme${process.pid}/app`;
const PR_URL = `https://github.com/${REPO}/pull/12`;
const HEAD = "c".repeat(40);

/** GitHub API stand-in for one PR: state, checks and comments are mutable. */
const gh = {
  state: "open", merged: false, body: "Fixes #7", author: "me",
  checks: [{ name: "tests", status: "completed", conclusion: "failure", html_url: "https://ci/1" }] as Array<Record<string, unknown>>,
  reviews: [] as Array<Record<string, unknown>>,
  calls: 0,
};
globalThis.fetch = (async (input: string | URL) => {
  gh.calls++;
  const url = new URL(String(input));
  const p = url.pathname;
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (p.endsWith("/pulls/12")) return json({ state: gh.state, merged: gh.merged, mergeable_state: "clean", user: { login: gh.author }, body: gh.body, head: { sha: HEAD, ref: "opensrcer/issue-7-x", repo: { full_name: "me/app" } }, base: { ref: "main" } });
  if (p.endsWith("/check-runs")) return json({ check_runs: gh.checks });
  if (p.endsWith("/status")) return json({ statuses: [] });
  if (p.endsWith("/pulls/12/reviews")) return json(gh.reviews);
  if (p.endsWith("/comments")) return json([]);
  return new Response("{}", { status: 404 });
}) as typeof fetch;

function seedRun(id: string, pr_url?: string) {
  persist({ id, auth0_user_id: OWNER, repo_url: `https://github.com/${REPO}`, mode: "agentic", dry_run: false, issue_number: 7,
    started_at: new Date().toISOString(), status: "succeeded", log_path: path.join(DIR, `${id}.log`), pr_status: "opened", ...(pr_url ? { pr_url } : {}) });
  return () => rmSync(path.join(DIR, `${id}.json`), { force: true });
}

function cleanState() {
  rmSync(path.join(DIR, "lifecycle", `${REPO.replace("/", "__")}__12.json`), { force: true });
}

test("ownedPr: only a PR one of the user's runs opened", async () => {
  const cleanup = seedRun(`d_followup_own_${process.pid}`, PR_URL);
  try {
    assert.deepEqual(await ownedPr(OWNER, PR_URL), { repo: REPO, number: 12, url: PR_URL });
    assert.equal(await ownedPr("someone-else", PR_URL), null);
    assert.equal(await ownedPr(OWNER, `https://github.com/${REPO}/pull/13`), null);
    assert.equal(await ownedPr(OWNER, "https://evil.example/pull/12"), null);
  } finally { cleanup(); }
});

test("pollFollowups records events once and reports what can be done; unknown PRs are 404", async () => {
  const cleanup = seedRun(`d_followup_poll_${process.pid}`, PR_URL);
  cleanState();
  gh.reviews = [{ id: 99, user: { login: "maintainer" }, body: "please rename", html_url: "https://gh/r/99", state: "CHANGES_REQUESTED", submitted_at: "t" }];
  try {
    const first = await pollFollowups(OWNER, PR_URL, "tok");
    assert.equal(first.ci, "failed");
    assert.deepEqual(first.recent.map((e) => e.kind), ["ci_failed", "comment"]);
    assert.equal(first.followups, false);
    assert.equal(first.can_fix_ci, false, "nothing is actionable before the opt-in");
    assert.equal(first.linked_issue, 7);
    const second = await pollFollowups(OWNER, PR_URL, "tok");
    assert.equal(second.recent.length, 2, "events are recorded once");
    await assert.rejects(pollFollowups("someone-else", PR_URL, "tok"), (e: FollowupError) => e.status === 404);
  } finally { cleanup(); cleanState(); gh.reviews = []; }
});

test("setFollowupOptIn persists per PR and refuses PRs the user does not own", async () => {
  const cleanup = seedRun(`d_followup_opt_${process.pid}`, PR_URL);
  cleanState();
  try {
    assert.equal(await setFollowupOptIn(OWNER, PR_URL, true), true);
    assert.equal((await pollFollowups(OWNER, PR_URL, "tok")).followups, true);
    assert.equal(await setFollowupOptIn(OWNER, PR_URL, false), false);
    await assert.rejects(setFollowupOptIn("mallory", PR_URL, true), (e: FollowupError) => e.status === 404);
  } finally { cleanup(); cleanState(); }
});

test("startFollowupRun: pinned to the PR head, marked as a follow-up, task fenced; refused without opt-in or a failure", async () => {
  const cleanup = seedRun(`d_followup_start_${process.pid}`, PR_URL);
  cleanState();
  const started: Array<{ repo: string; issue: number; opts: StartAgenticOpts }> = [];
  const start = async (repo: string, issue: number, opts: StartAgenticOpts) => { started.push({ repo, issue, opts }); return { id: "d_new" }; };
  try {
    await pollFollowups(OWNER, PR_URL, "tok");
    await assert.rejects(startFollowupRun(OWNER, PR_URL, "ci", "tok", {}, start), (e: FollowupError) => e.status === 409 && /Turn on/.test(e.message));
    await setFollowupOptIn(OWNER, PR_URL, true);
    await assert.rejects(startFollowupRun(OWNER, PR_URL, "review", "tok", {}, start), (e: FollowupError) => e.status === 409 && /review comment/.test(e.message));
    assert.deepEqual(await startFollowupRun(OWNER, PR_URL, "ci", "tok", { provider: "anthropic-key", maxSpendUsd: 1 }, start), { id: "d_new" });
    assert.equal(started.length, 1);
    const { repo, issue, opts } = started[0];
    assert.equal(repo, `https://github.com/${REPO}`);
    assert.equal(issue, 7);
    assert.equal(opts.dryRun, false, "it ends at the publish gate like a live run");
    assert.equal(opts.repoRef, HEAD);
    assert.equal(opts.followupPr, PR_URL);
    assert.equal(opts.provider, "anthropic-key");
    assert.equal(opts.allowClosedIssue, undefined, "web routes never accept closed issues");
    assert.match(opts.notes!, /CI failed on cccccccccccc: tests \(https:\/\/ci\/1\)/);
    gh.body = "no issue link here";
    await assert.rejects(startFollowupRun(OWNER, PR_URL, "ci", "tok", {}, start), /names no issue/);
    gh.body = "Fixes #7";
    gh.state = "closed";
    await assert.rejects(startFollowupRun(OWNER, PR_URL, "ci", "tok", {}, start), /no longer open/);
    assert.equal(started.length, 1);
  } finally { cleanup(); cleanState(); gh.state = "open"; gh.body = "Fixes #7"; }
});

test("followupView: a merged PR offers no actions", () => {
  const snap: PrSnapshot = { state: "closed", merged: true, author: "me", body: "Fixes #7", head_sha: HEAD, head_ref: "b", head_repo: "me/app", base_ref: "main", mergeable_state: null, checks: [], comments: [] };
  const state = { ...initialState({ repo: REPO, number: 12 }), followups: true, recent: [{ kind: "ci_failed" as const, head_sha: HEAD, checks: [], at: "t" }] };
  const view = followupView({ repo: REPO, number: 12, url: PR_URL }, snap, state);
  assert.equal(view.state, "merged");
  assert.equal(view.can_fix_ci, false);
  assert.equal(view.can_address_review, false);
});
