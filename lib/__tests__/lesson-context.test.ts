import { test } from "node:test";
import assert from "node:assert/strict";
import { answerKeyStatus, loadLessonContext, type ContextDeps } from "../lesson/context";
import type { Lesson } from "../lesson/store";
import type { StoredPreview } from "../publish";
import type { Verification } from "../verify";

const verification = (status: Verification["status"], regression: Verification["regression"]): Verification =>
  ({ status, regression, reason: "r", plan: { setup: [], test: [], lint: [] }, evidence: [] });
const stored = (over: Partial<StoredPreview["preview"]> = {}, diff = "+fix"): StoredPreview => ({
  diff,
  preview: { version: 1, created_at: "t", title: "Keep the session", body: "b", commit_message: "c", signoff: false, files: ["a.py"], executed: true,
    verification: verification("verified", "reproduced"), profile: null, blockers: [], warnings: [], diagnosis: "the cause", cases: [{ variant: "v", test: "t" }], ...over },
});

test("answer key status: verified only when the fix passed and its test fails without it", () => {
  assert.equal(answerKeyStatus(null, null), "pending");
  assert.equal(answerKeyStatus({ status: "running" }, null), "pending");
  assert.equal(answerKeyStatus({ status: "failed" }, stored()), "failed");
  assert.equal(answerKeyStatus({ status: "killed" }, null), "failed");
  assert.equal(answerKeyStatus({ status: "succeeded" }, null), "failed", "finished without a preview");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored({}, "  ")), "failed", "an empty patch is no key");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored()), "verified");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored({ verification: verification("verified", "not_reproduced") })), "unverified", "the test passes without the fix");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored({ verification: verification("verified", "no_test_change") })), "unverified", "no new test");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored({ executed: false })), "unverified");
  assert.equal(answerKeyStatus({ status: "succeeded" }, stored({ verification: null })), "unverified");
});

const lesson: Lesson = {
  id: "l_1700000000000_aaaaaaaaaaaa", owner: "auth0|alice", repo_url: "https://github.com/pallets/flask", issue_number: 5, run_id: "c_1700000000000_bbbbbbbbbbbb",
  mode: "short", path: "A", stage: "kickoff", answer_key: "pending", turns_used: 0, created_at: "t", steps: {},
};

function deps(run: Awaited<ReturnType<ContextDeps["run"]>>): { d: ContextDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    d: {
      token: "gho_x",
      issue: async (repo, n, token) => { calls.push(`issue ${repo}#${n} ${token}`); return { title: "Session lost", body: "body" }; },
      readme: async (repo) => { calls.push(`readme ${repo}`); return "README"; },
      graph: async (owner, repo) => { calls.push(`graph ${owner} ${repo}`); return null; },
      run: async (owner, id) => { calls.push(`run ${owner} ${id}`); return run; },
      practiced: async () => 2,
    },
  };
}

test("the lesson context loads the issue, README, graph and answer key for the lesson's owner", async () => {
  const { d, calls } = deps({ run: { status: "succeeded" } as never, stored: stored() });
  const ctx = await loadLessonContext(lesson, d);
  assert.equal(ctx.repo, "pallets/flask");
  assert.deepEqual(ctx.issue, { number: 5, title: "Session lost", body: "body" });
  assert.equal(ctx.answerKeyStatus, "verified");
  assert.deepEqual(ctx.answerKey, { diff: "+fix", diagnosis: "the cause", cases: [{ variant: "v", test: "t" }], title: "Keep the session" });
  assert.equal(ctx.practiced, 2);
  assert.ok(calls.includes("run auth0|alice c_1700000000000_bbbbbbbbbbbb"), "the run is read as the lesson's owner");
  assert.ok(calls.includes("issue pallets/flask#5 gho_x"));
});

test("no answer key while the fix runs, or when it failed", async () => {
  assert.equal((await loadLessonContext(lesson, deps({ run: { status: "running" } as never, stored: null }).d)).answerKey, null);
  const failed = await loadLessonContext(lesson, deps({ run: { status: "failed" } as never, stored: stored() }).d);
  assert.equal(failed.answerKeyStatus, "failed");
  assert.equal(failed.answerKey, null);
  assert.equal((await loadLessonContext(lesson, deps(null).d)).answerKeyStatus, "pending", "a run not found yet");
});
