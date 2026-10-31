// lib/lesson/db-store.ts on PGlite: the same contract as MemoryLessonStore
// (lesson-store.test.ts), through the real migrations.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type Db, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { repos, users } from "../db/schema";
import { DbLessonStore } from "../lesson/db-store";
import { LESSON_ID_RE, LessonNotFoundError, type LessonStep } from "../lesson/store";

let connection: DbConnection;
let store: DbLessonStore;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  store = new DbLessonStore(async () => connection.db as unknown as Db);
});
after(() => connection.close());

const input = { owner: "auth0|a", repo_url: "https://github.com/o/r", issue_number: 1, run_id: "d_1", mode: "short" as const, path: "A" as const, stage: "kickoff" as const, answer_key: "pending" as const };
const step = (over: Partial<LessonStep> = {}): LessonStep => ({ step: "s1", answer: "a", grade: null, done: true, hint_level: -1, hints_used: [], updated_at: "2026-10-30T10:00:00.000Z", ...over });
const missing = "l_00000000-0000-4000-8000-000000000000";

test("create, get, update the stage and every field, and save steps", async () => {
  const lesson = await store.create(input);
  assert.match(lesson.id, LESSON_ID_RE);
  assert.deepEqual(
    [lesson.owner, lesson.repo_url, lesson.issue_number, lesson.run_id, lesson.mode, lesson.path, lesson.stage, lesson.answer_key, lesson.turns_used, lesson.gave_up, lesson.revealed_at],
    ["auth0|a", "https://github.com/o/r", 1, "d_1", "short", "A", "kickoff", "pending", 0, undefined, undefined],
  );
  assert.deepEqual(lesson.steps, {});
  const moved = await store.updateStage(lesson.id, "locate", {
    answer_key: "verified", turns_used: 3, gave_up: true, revealed_at: "2026-10-30T11:00:00.000Z", path: "B", mode: "full",
    base_sha: "a".repeat(40), ide_diff: "diff", ide_submitted_at: "2026-10-30T12:00:00.000Z",
  });
  assert.deepEqual(
    [moved.stage, moved.answer_key, moved.turns_used, moved.gave_up, moved.revealed_at, moved.path, moved.mode, moved.base_sha, moved.ide_diff, moved.ide_submitted_at],
    ["locate", "verified", 3, true, "2026-10-30T11:00:00.000Z", "B", "full", "a".repeat(40), "diff", "2026-10-30T12:00:00.000Z"],
  );
  assert.equal((await store.updateStage(lesson.id, "predict", { answer_key: "pending" })).answer_key, "pending");
  const withStep = await store.saveStep(lesson.id, step({ grade: { passed: true, feedback: "good", detail: { parts: 2 } } }));
  assert.deepEqual(withStep.steps.s1, step({ grade: { passed: true, feedback: "good", detail: { parts: 2 } } }));
  // Saving again replaces the row (a hint after an answer).
  const hinted = await store.saveStep(lesson.id, step({ hint_level: 2, hints_used: [0, 2] }));
  assert.deepEqual([hinted.steps.s1?.hint_level, hinted.steps.s1?.hints_used, hinted.steps.s1?.grade], [2, [0, 2], null]);
  assert.equal(Object.keys(hinted.steps).length, 1);
});

test("the user and repo rows are created once and shared", async () => {
  const a = await store.create(input);
  const b = await store.create({ ...input, issue_number: 2 });
  assert.notEqual(a.id, b.id);
  const db = connection.db as unknown as Db;
  assert.equal((await db.select().from(users)).filter((u) => u.id === "auth0|a").length, 1);
  assert.equal((await db.select().from(repos)).filter((r) => r.owner === "o" && r.name === "r").length, 1);
});

test("messages keep their order, step and time, and list newest-last, bounded", async () => {
  const { id } = await store.create(input);
  for (let i = 0; i < 5; i++) {
    await store.appendMessage(id, { role: i % 2 ? "teacher" : "user", content: `m${i}`, step: i === 0 ? "s4" : null, at: `2026-10-30T10:00:0${i}.000Z` });
  }
  assert.deepEqual((await store.listMessages(id, 2)).map((m) => m.content), ["m3", "m4"]);
  const all = await store.listMessages(id);
  assert.equal(all.length, 5);
  assert.deepEqual(all[0], { role: "user", content: "m0", step: "s4", at: "2026-10-30T10:00:00.000Z" });
  assert.deepEqual(await store.listMessages(id, 0), []);
  assert.deepEqual(await store.listMessages(missing), []);
  assert.deepEqual(await store.listMessages("l_not-a-uuid"), []);
});

test("unknown and malformed ids read as missing; writes to them fail loudly", async () => {
  for (const id of [missing, "l_1700000000000_aaaaaaaaaaaa", "x", ""]) {
    assert.equal(await store.get(id), null, id);
    await assert.rejects(store.updateStage(id, "locate"), LessonNotFoundError, id);
    await assert.rejects(store.saveStep(id, step()), LessonNotFoundError, id);
    await assert.rejects(store.appendMessage(id, { role: "user", content: "x", step: null, at: "t" }), LessonNotFoundError, id);
  }
});
