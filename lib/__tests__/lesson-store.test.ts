import { test } from "node:test";
import assert from "node:assert/strict";
import { LessonNotFoundError, MemoryLessonStore, newLessonId } from "../lesson/store";

const input = { owner: "auth0|a", repo_url: "https://github.com/o/r", issue_number: 1, run_id: "c_1", mode: "short" as const, path: "A" as const, stage: "kickoff" as const, answer_key: "pending" as const };

test("create, get, update the stage and save steps; callers get copies", async () => {
  const store = new MemoryLessonStore();
  const lesson = await store.create(input);
  assert.match(lesson.id, /^l_\d{13}_[a-f0-9]{12}$/);
  assert.equal(lesson.turns_used, 0);
  assert.deepEqual(lesson.steps, {});
  lesson.stage = "done";
  assert.equal((await store.get(lesson.id))!.stage, "kickoff", "mutating a returned lesson changes nothing stored");
  const moved = await store.updateStage(lesson.id, "locate", { answer_key: "verified", turns_used: 3 });
  assert.deepEqual([moved.stage, moved.answer_key, moved.turns_used], ["locate", "verified", 3]);
  const withStep = await store.saveStep(lesson.id, { step: "s1", answer: "a", grade: null, done: true, hint_level: -1, hints_used: [], updated_at: "t" });
  assert.equal(withStep.steps.s1?.done, true);
  assert.equal(await store.get("l_missing"), null);
  assert.notEqual(newLessonId(), newLessonId());
});

test("messages are kept in order and listed newest-last, bounded", async () => {
  const store = new MemoryLessonStore();
  const { id } = await store.create(input);
  for (let i = 0; i < 5; i++) await store.appendMessage(id, { role: i % 2 ? "teacher" : "user", content: `m${i}`, step: null, at: "t" });
  assert.deepEqual((await store.listMessages(id, 2)).map((m) => m.content), ["m3", "m4"]);
  assert.equal((await store.listMessages(id)).length, 5);
  assert.deepEqual(await store.listMessages(id, 0), []);
  assert.deepEqual(await store.listMessages("l_missing"), []);
});

test("writes to a missing lesson fail loudly", async () => {
  const store = new MemoryLessonStore();
  await assert.rejects(store.updateStage("l_nope", "locate"), LessonNotFoundError);
  await assert.rejects(store.saveStep("l_nope", { step: "s1", answer: "", grade: null, done: false, hint_level: -1, hints_used: [], updated_at: "t" }), LessonNotFoundError);
  await assert.rejects(store.appendMessage("l_nope", { role: "user", content: "x", step: null, at: "t" }), LessonNotFoundError);
});
