import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// In-memory Blob/Sandbox stand-ins, installed before the cloud code loads
// (same approach as cloud-capacity.test.ts). The push VM is replaced by an
// injected job function; GitHub reads go through a stubbed fetch.
// Hosted mode, so the gate records (reveal marker, own-words result) live in the Blob stand-in.
process.env.OPENSRCER_EXECUTION = "sandbox";
const store = new Map<string, { body: string; etag: string }>();
let etags = 0;
class BlobPreconditionFailedError extends Error {}
class BlobNotFoundError extends Error {}
const fakeBlob = {
  BlobPreconditionFailedError,
  BlobNotFoundError,
  async get(path: string) {
    const entry = store.get(path);
    return entry ? { statusCode: 200, stream: entry.body, blob: { size: entry.body.length, etag: entry.etag } } : null;
  },
  async put(path: string, body: string, opts: { allowOverwrite?: boolean } = {}) {
    if (store.has(path) && !opts.allowOverwrite) throw new Error("This blob already exists");
    store.set(path, { body, etag: String(++etags) });
    return { pathname: path };
  },
  async del(path: string | string[]) { for (const p of [path].flat()) store.delete(p); },
  async list() { return { blobs: [], hasMore: false }; },
  async head() { throw new BlobNotFoundError(); },
};
class APIError extends Error { response = { status: 404 }; }
const fakeSandbox = { APIError, Sandbox: { async get() { throw new APIError(); } } };
const req = createRequire(__filename);
for (const [id, fake] of [["@vercel/blob", fakeBlob], ["@vercel/sandbox", fakeSandbox], ["@vercel/blob/client", {}]] as const) {
  const resolved = req.resolve(id);
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fake } as never;
}

let timeline: unknown[] = [];
let contributing: string | null = null;
const followupPr = { state: "open", author: "alice" };
globalThis.fetch = (async (url: string | URL) => {
  const href = String(url);
  const path = new URL(href).pathname;
  // The AI-policy read (lib/ai-policy.ts): one GraphQL call; f0 is the root CONTRIBUTING.md.
  const body = path === "/graphql" ? { data: { repository: { f0: contributing === null ? null : { text: contributing } } } }
    : href.includes("/timeline") ? timeline
    : path.endsWith("/pulls/12") ? { state: followupPr.state, merged: false, mergeable_state: "clean", user: { login: followupPr.author }, body: "Fixes #7",
      head: { sha: "c".repeat(40), ref: "opensrcer/issue-7-x", repo: { full_name: "alice/app" } }, base: { ref: "main" } }
    : path.endsWith("/check-runs") ? { check_runs: [] }
    : path.endsWith("/status") ? { statuses: [] }
    : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const OWNER = "auth0|alice";
const author = { login: "alice", id: 42 };
const signal = new AbortController().signal;

async function seed(overrides: Record<string, unknown> = {}, blockers: string[] = [], understood = true) {
  const { newCloudRunId, runPath, runPreviewPath } = await import("../cloud-run-state");
  const id = newCloudRunId();
  store.set(runPath(OWNER, id), { etag: String(++etags), body: JSON.stringify({
    id, auth0_user_id: OWNER, repo_url: "https://github.com/acme/app", issue_number: 7, mode: "agentic", dry_run: false,
    started_at: new Date().toISOString(), ended_at: new Date().toISOString(), status: "succeeded", pr_status: "awaiting_review",
    log_path: "", sandbox_name: id.replaceAll("_", "-"), sandbox_stopped: true, expires_at: Date.now() + 60_000,
    log: "done\n", log_size: 5, has_preview: true, ...overrides,
  }) });
  store.set(runPreviewPath(OWNER, id), { etag: String(++etags), body: JSON.stringify({
    version: 1, created_at: "t", title: "fix: x", body: "Fixes #7", commit_message: "fix: x", signoff: false, files: ["a.py"],
    executed: false, verification: null, profile: null, blockers, warnings: [], diff: "--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-1\n+2\n",
  }) });
  // The own-words check passed for WORDS (lib/understanding-record.ts), unless a test says otherwise.
  if (understood) {
    const { recordUnderstanding } = await import("../understanding-record");
    await recordUnderstanding(OWNER, id, { kind: "passed", text: WORDS.text });
  }
  return id;
}

const WORDS = { text: "The value was off by one, so 1 was written where 2 belongs. The change writes 2, and the run's check confirms it.", checked: true, practiced: true };

test("hosted publish: the shared gate refuses before any VM starts", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  let jobs = 0;
  const job = async () => { jobs++; return { ok: true as const, url: "https://github.com/acme/app/pull/1", tests: "not_run" }; };
  const id = await seed();
  await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: false, token: "t", author, signal }, job), /Confirm first/);
  await assert.rejects(publishCloudRun({ id, viewerId: "auth0|mallory", confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /not found/);
  await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: null, author: null, signal }, job), /Sign in with GitHub/);
  const dry = await seed({ dry_run: true });
  await assert.rejects(publishCloudRun({ id: dry, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /preview-only/);
  const blocked = await seed({}, ["this project does not accept AI-generated contributions"]);
  await assert.rejects(publishCloudRun({ id: blocked, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /blocked/);
  timeline = [{ event: "cross-referenced", source: { issue: { number: 9, state: "open", pull_request: {}, html_url: "https://github.com/acme/app/pull/9" } } }];
  await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /already targets this issue/);
  timeline = [];
  assert.equal(jobs, 0);
});

test("hosted publish: refuses without a recorded own-words pass, and a hidden run until the reveal", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { revealHiddenRun } = await import("../hidden-runs");
  let jobs = 0;
  const job = async () => { jobs++; return { ok: true as const, url: "https://github.com/acme/app/pull/2", tests: "not_run" }; };
  const unchecked = await seed({}, [], false);
  await assert.rejects(publishCloudRun({ id: unchecked, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /pass the check before publishing/);
  const checked = await seed();
  await assert.rejects(publishCloudRun({ id: checked, viewerId: OWNER, confirmed: true, authorWords: { ...WORDS, text: "Something else I wrote after the check passed, long enough to count." }, token: "t", author, signal }, job), /must be the one that passed/);
  const hidden = await seed({ hidden: true });
  await assert.rejects(publishCloudRun({ id: hidden, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /hidden until the lesson reveals it/);
  assert.equal(jobs, 0);
  await revealHiddenRun(OWNER, hidden);
  assert.equal((await publishCloudRun({ id: hidden, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job)).url, "https://github.com/acme/app/pull/2");
});

test("hosted publish: opens once from the stored preview and records the PR", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { getCloudRun } = await import("../cloud-runs");
  const seen: unknown[] = [];
  const job = async (j: unknown) => { seen.push(j); return { ok: true as const, url: "https://github.com/acme/app/pull/12", tests: "not_run" }; };
  const id = await seed();
  const result = await publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job);
  assert.equal(result.url, "https://github.com/acme/app/pull/12");
  const sent = seen[0] as { repo: string; issueNumber: number; stored: { diff: string; preview: { title: string } } };
  assert.equal(sent.repo, "acme/app");
  assert.equal(sent.issueNumber, 7);
  assert.match(sent.stored.diff, /\+2/);
  assert.equal(sent.stored.preview.title, "fix: x");
  const run = await getCloudRun(OWNER, id);
  assert.equal(run?.pr_status, "opened");
  assert.equal(run?.pr_url, "https://github.com/acme/app/pull/12");
  assert.ok(run?.published_at);
  await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job), /already published/);
});

test("hosted publish: the project's AI policy, read live, refuses a ban and adds the disclosure it asks for", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { clearAiPolicyCache } = await import("../ai-policy");
  const seen: Array<{ stored: { preview: { body: string } } }> = [];
  const job = async (j: unknown) => { seen.push(j as never); return { ok: true as const, url: "https://github.com/acme/app/pull/15", tests: "not_run" }; };
  try {
    clearAiPolicyCache();
    contributing = "No LLMs for issues, pull requests, or comments.";
    await assert.rejects(publishCloudRun({ id: await seed(), viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, job),
      (e: Error & { status?: number }) => e.status === 409 && /CONTRIBUTING\.md: "No LLMs/.test(e.message));
    assert.equal(seen.length, 0);
    clearAiPolicyCache();
    contributing = "If you use AI tools when you contribute, you must disclose that fact in the pull request.";
    const approach = ["Where I started looking: a.py"];
    await publishCloudRun({ id: await seed(), viewerId: OWNER, confirmed: true, authorWords: WORDS, approach, token: "t", author, signal }, job);
    assert.match(seen[0].stored.preview.body, /### How I approached this\n\n- Where I started looking: a\.py/);
    assert.match(seen[0].stored.preview.body, /This project's AI policy \(CONTRIBUTING\.md\) asks contributors to disclose AI use: "If you use AI tools/);
  } finally {
    contributing = null;
    clearAiPolicyCache();
  }
});

test("hosted publish: a failed job is recorded and can be retried", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { getCloudRun } = await import("../cloud-runs");
  const id = await seed();
  await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, async () => ({ ok: false as const, reason: "push rejected" })), /push rejected/);
  assert.equal((await getCloudRun(OWNER, id))?.pr_status, "failed");
  const ok = await publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, async () => ({ ok: true as const, url: "https://github.com/acme/app/pull/13", tests: "not_run" }));
  assert.equal(ok.url, "https://github.com/acme/app/pull/13");
});

test("hosted publish of an executed run hands the verified final patch and its evidence to the push VM unchanged", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { runPreviewPath } = await import("../cloud-run-state");
  const id = await seed();
  const verification = { status: "verified", reason: "declared tests pass", regression: "reproduced", plan: { setup: [], test: ["pytest t.py"], lint: [] },
    evidence: [{ kind: "test", command: "pytest t.py", exit_code: 0, timed_out: false, duration_ms: 900, output_tail: "1 passed" }] };
  const stored = JSON.parse(store.get(runPreviewPath(OWNER, id))!.body);
  store.set(runPreviewPath(OWNER, id), { etag: String(++etags), body: JSON.stringify({ ...stored, executed: true, verification, body: "Fixes #7\n\n### Tests run\n\n- `pytest t.py` — passed" }) });
  const seen: Array<{ stored: { diff: string; preview: { executed: boolean; verification: unknown; body: string } } }> = [];
  await publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, async (j) => { seen.push(j as never); return { ok: true as const, url: "https://github.com/acme/app/pull/14", tests: "passed" }; });
  assert.equal(seen[0].stored.diff, stored.diff);
  assert.equal(seen[0].stored.preview.executed, true);
  assert.deepEqual(seen[0].stored.preview.verification, verification);
  assert.match(seen[0].stored.preview.body, /### Tests run/);
});

test("hosted follow-up publish pushes one commit to the user's own open PR branch, skipping the new-PR caps", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const { getCloudRun } = await import("../cloud-runs");
  const PR = "https://github.com/acme/app/pull/12";
  const id = await seed({ followup_pr: PR });
  // Another open PR on the issue would block a new PR, not a follow-up.
  timeline = [{ event: "cross-referenced", source: { issue: { number: 12, state: "open", pull_request: {}, html_url: PR } } }];
  const pushes: Array<{ repo: string; branch: string; diff: string }> = [];
  const neverJob = async () => { throw new Error("a follow-up never opens a PR"); };
  try {
    const result = await publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, neverJob,
      async (input) => { pushes.push(input); return { ok: true, commit: "abc12345", message: "Pushed commit abc12345" }; });
    assert.deepEqual(result, { url: PR, tests: "not_run" });
    assert.deepEqual(pushes.map((p) => [p.repo, p.branch]), [["alice/app", "opensrcer/issue-7-x"]]);
    assert.match(pushes[0].diff, /\+2/);
    const run = await getCloudRun(OWNER, id);
    assert.equal(run?.pr_status, "opened");
    assert.equal(run?.pr_url, PR);
    assert.equal(run?.published_at, undefined);
  } finally { timeline = []; }
});

test("hosted follow-up publish refuses a PR that is not the user's, without pushing", async () => {
  const { publishCloudRun } = await import("../cloud-publish");
  const id = await seed({ followup_pr: "https://github.com/acme/app/pull/12" });
  followupPr.author = "mallory";
  try {
    await assert.rejects(publishCloudRun({ id, viewerId: OWNER, confirmed: true, authorWords: WORDS, token: "t", author, signal }, async () => { throw new Error("no"); },
      async () => { throw new Error("must not push"); }), /only to your own pull requests/);
  } finally { followupPr.author = "alice"; }
});
