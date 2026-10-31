// Standing events into PGlite: append-only, deduplicated, and the level
// rebuilt from them. Plus the pure replay rules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { InvalidRepoNameError } from "../ai-policy";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { repos, standingEvents, users } from "../db/schema";
import type { Lesson } from "../lesson/store";
import {
  appendEvents, capsLevel, capsLevelFor, clearSpamFlag, ensureRepo, ensureUser, importedPoints, InvalidLoginError, InvalidStandingEventError,
  lessonCleanEvent, mergedPoints, rebuildStanding, recordLessonFinished, recordView, replay, repoOfRef, UnknownSpamFlagError, UnknownUserError,
  type StandingEvent,
} from "../record/standing";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

let n = 0;
async function newUser(): Promise<string> {
  const id = `github|${++n}`;
  await ensureUser(connection.db, id, `user${n}`);
  return id;
}

const merged = (repo: string, pr: number, self = false, earlier = 0): StandingEvent => ({ kind: self ? "merged_self" : "merged", ref: `${repo}#${pr}`, points: mergedPoints(self, earlier) });

test("points: PR opened earns nothing; merged 100, x1.5 path B, x1.5 continuity; imported half", () => {
  assert.deepEqual([mergedPoints(false, 0), mergedPoints(true, 0), mergedPoints(false, 1), mergedPoints(true, 3)], [100, 150, 150, 225]);
  assert.equal(importedPoints(), 50);
  assert.equal(repoOfRef("Pallets/Flask#12"), "pallets/flask");
  for (const bad of ["pallets/flask", "#12", "a/b/c#1", "lesson_1"]) assert.equal(repoOfRef(bad), null, bad);
});

test("replay: the level only rises, and a spam flag freezes it until cleared", () => {
  const events = [merged("a/x", 1), merged("a/x", 2, true, 1), merged("a/x", 3, false, 2)];
  assert.equal(replay(events).level, "regular");
  // An unanswered review after reaching regular does not take it away (levels never go down).
  assert.equal(replay([...events, { kind: "review_unanswered", ref: "a/x#4", points: 0 }]).level, "regular");
  // Flag first: merges while flagged do not level up; clearing lets the next event count.
  const flagged = [{ kind: "spam_flag", ref: "burst:2026-10-01", points: 0 }, ...events];
  assert.equal(replay(flagged).level, "newcomer");
  assert.deepEqual(replay(flagged).flags, ["burst:2026-10-01"]);
  const cleared = replay([...flagged, { kind: "spam_cleared", ref: "burst:2026-10-01", points: 0 }]);
  assert.equal(cleared.level, "regular");
  assert.deepEqual(cleared.flags, []);
  // Unknown kinds (from a later version) are ignored, not counted.
  assert.deepEqual(replay([{ kind: "pr_opened", ref: "a/x#9", points: 5 }]).standing, 0);
  assert.deepEqual(replay([]).level, "newcomer");
  const r = replay([...events, { kind: "approval", ref: "a/x#1", points: 30 }]);
  assert.equal(r.standing, 100 + 225 + 150 + 30);
  assert.deepEqual(r.breakdown, { merged: 250, merged_self: 225, approval: 30 });
});

test("appendEvents: validates first, skips duplicates, never updates", async () => {
  const id = await newUser();
  assert.equal(await appendEvents(connection.db, id, [merged("a/x", 1), { kind: "approval", ref: "a/x#1", points: 30 }]), 2);
  assert.equal(await appendEvents(connection.db, id, [merged("a/x", 1), { kind: "approval", ref: "a/x#2", points: 30 }]), 1, "the repeat is skipped");
  assert.equal(await appendEvents(connection.db, id, []), 0);
  for (const bad of [
    { kind: "nope", ref: "a/x#1", points: 0 }, { kind: "merged", ref: "", points: 100 }, { kind: "merged", ref: "x".repeat(301), points: 100 },
    { kind: "merged", ref: "a/x#9", points: -1 }, { kind: "merged", ref: "a/x#9", points: 1.5 },
  ]) await assert.rejects(appendEvents(connection.db, id, [merged("a/x", 50), bad as StandingEvent]), InvalidStandingEventError, JSON.stringify(bad));
  await assert.rejects(appendEvents(connection.db, "github|404", [merged("a/x", 1)]), UnknownUserError);
  const rows = await connection.db.select().from(standingEvents).where(eq(standingEvents.userId, id));
  assert.equal(rows.length, 3, "nothing from the rejected batches was written");
});

test("rebuildStanding: caches level and standing on users; unknown user throws", async () => {
  const id = await newUser();
  await appendEvents(connection.db, id, [merged("a/x", 1)]);
  const r = await rebuildStanding(connection.db, id);
  assert.equal(r.level, "contributor");
  const [row] = await connection.db.select().from(users).where(eq(users.id, id));
  assert.deepEqual([row.level, row.standing], [1, 100]);
  await assert.rejects(rebuildStanding(connection.db, "github|404"), UnknownUserError);
});

test("capsLevel: newcomer with no record and while a spam flag is open; clearSpamFlag needs an open flag", async () => {
  assert.equal(await capsLevel(connection.db, "github|404"), "newcomer");
  const id = await newUser();
  await appendEvents(connection.db, id, [merged("a/x", 1)]);
  assert.equal(await capsLevel(connection.db, id), "contributor");
  await appendEvents(connection.db, id, [{ kind: "spam_flag", ref: "objection:a/x#2", points: 0 }]);
  assert.equal(await capsLevel(connection.db, id), "newcomer");
  await assert.rejects(clearSpamFlag(connection.db, id, "burst:2020-01-01"), UnknownSpamFlagError);
  assert.equal((await clearSpamFlag(connection.db, id, "objection:a/x#2")).level, "contributor");
  assert.equal(await capsLevel(connection.db, id), "contributor");
  await assert.rejects(clearSpamFlag(connection.db, id, "objection:a/x#2"), UnknownSpamFlagError, "already cleared");
  await assert.rejects(clearSpamFlag(connection.db, "github|404", "x"), UnknownUserError);
});

test("capsLevelFor: newcomer (today's caps) while OPENSRCER_RECORD is off, without touching a database", async () => {
  const saved = process.env.OPENSRCER_RECORD;
  delete process.env.OPENSRCER_RECORD;
  try { assert.equal(await capsLevelFor("github|1"), "newcomer"); }
  finally { if (saved !== undefined) process.env.OPENSRCER_RECORD = saved; }
});

test("ensureUser and ensureRepo: validated, idempotent, repos matched case-insensitively", async () => {
  await assert.rejects(ensureUser(connection.db, "github|900", "bad login!"), InvalidLoginError);
  await assert.rejects(ensureUser(connection.db, "", "ok"), RangeError);
  await ensureUser(connection.db, "github|900", "old");
  await ensureUser(connection.db, "github|900", "renamed");
  const [row] = await connection.db.select().from(users).where(eq(users.id, "github|900"));
  assert.equal(row.login, "renamed");
  const a = await ensureRepo(connection.db, "Pallets/Flask");
  assert.equal(await ensureRepo(connection.db, "pallets/flask"), a);
  assert.equal((await connection.db.select().from(repos).where(eq(repos.id, a)))[0].owner, "Pallets", "the first spelling is kept");
  for (const bad of ["", "flask", "a/b/c", "../x"]) await assert.rejects(ensureRepo(connection.db, bad), InvalidRepoNameError, bad);
});

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "l_1_aaaaaaaaaaaa", owner: "github|1", repo_url: "https://github.com/a/x", issue_number: 1, run_id: "d_1", mode: "short", path: "A",
  stage: "done", answer_key: "verified", turns_used: 0, created_at: "t", steps: {}, ...over,
});
const step = (hint_level: number) => ({ step: "s8" as const, answer: "x", grade: null, done: true, hint_level, hints_used: [], updated_at: "t" });

test("lessonCleanEvent: finished without a level-3 hint earns 15; given up, unfinished or level 3 earns nothing", () => {
  assert.deepEqual(lessonCleanEvent(lesson({ steps: { s8: step(2) } })), { kind: "lesson_clean", ref: "l_1_aaaaaaaaaaaa", points: 15 });
  for (const [name, l] of [
    ["level 3 hint", lesson({ steps: { s8: step(3) } })], ["gave up", lesson({ gave_up: true })], ["not done", lesson({ stage: "next" })],
  ] as const) assert.equal(lessonCleanEvent(l), null, name);
});

test("recordLessonFinished: creates the user, appends once, rebuilds", async () => {
  const l = lesson({ id: "l_2_bbbbbbbbbbbb", owner: "github|901" });
  await recordLessonFinished(connection.db, "github|901", "learner", l);
  await recordLessonFinished(connection.db, "github|901", "learner", l);
  const [row] = await connection.db.select().from(users).where(eq(users.id, "github|901"));
  assert.equal(row.standing, 15);
  await recordLessonFinished(connection.db, "github|902", "gaveup", lesson({ gave_up: true }));
  assert.equal((await connection.db.select().from(users).where(eq(users.id, "github|902"))).length, 0, "nothing earned, nothing written");
});

test("recordView: the user's own record; unknown user throws", async () => {
  const id = await newUser();
  await appendEvents(connection.db, id, [merged("a/x", 7), { kind: "spam_flag", ref: "burst:2026-10-02", points: 0 }]);
  const view = await recordView(connection.db, id);
  assert.equal(view.level, "contributor", "earned before the flag; a flag freezes, it never takes a level away");
  assert.equal(view.standing, 100);
  assert.deepEqual(view.spamFlags, ["burst:2026-10-02"]);
  assert.deepEqual(view.contributions, []);
  await assert.rejects(recordView(connection.db, "github|404"), UnknownUserError);
});
