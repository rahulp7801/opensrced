// lib/ide/lesson-api.ts: the IDE lesson routes' contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_NOT_CONNECTED, runEventStream, validLessonId, type RunEvent } from "../ide/lesson-api";
import { sseEvents } from "../sse";

for (const [id, ok] of [["demo", true], ["a_b-C9", true], ["x".repeat(64), true], ["x".repeat(65), false], ["", false], ["../x", false], ["a b", false], [7, false], [null, false]] as Array<[unknown, boolean]>) {
  test(`validLessonId(${JSON.stringify(id)}) is ${ok}`, () => assert.equal(validLessonId(id), ok));
}

test("the run stream round-trips through the browser's SSE reader and ends in exit", async () => {
  const events: RunEvent[] = [];
  for await (const event of sseEvents<RunEvent>(new Response(runEventStream(RUN_NOT_CONNECTED)))) events.push(event);
  assert.deepEqual(events, RUN_NOT_CONNECTED);
  assert.equal(events.at(-1)?.type, "exit");
  assert.match((events[0] as { data: string }).data, /isn't connected yet/);
  assert.equal(runEventStream([]), "");
});
