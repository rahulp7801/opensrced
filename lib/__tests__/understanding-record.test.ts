import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { applyUnderstandingEvent, explanationSha, normalizeExplanation, readUnderstanding, recordUnderstanding } from "../understanding-record";

delete process.env.VERCEL;
delete process.env.OPENSRCER_EXECUTION;

const now = new Date("2026-10-27T12:00:00.000Z");

test("events: a pass stores the text's hash, practice counts only after a pass, an outage is noted", () => {
  const passed = applyUnderstandingEvent(null, { kind: "passed", text: "  The cause was X.\r\n\n\n\nNow Y. " }, now);
  assert.equal(passed.passed_sha, explanationSha("The cause was X.\n\nNow Y."), "hashed after the same normalization as the PR text");
  assert.equal(passed.passed_at, now.toISOString());
  assert.equal(applyUnderstandingEvent(null, { kind: "practiced" }).practiced, 0, "practice before a pass does not count");
  const practiced = applyUnderstandingEvent(applyUnderstandingEvent(passed, { kind: "practiced" }), { kind: "practiced" });
  assert.equal(practiced.practiced, 2);
  assert.equal(applyUnderstandingEvent(practiced, { kind: "passed", text: "A newer text." }).practiced, 0, "a new pass starts practice over");
  let many = passed;
  for (let i = 0; i < 20; i++) many = applyUnderstandingEvent(many, { kind: "practiced" });
  assert.equal(many.practiced, 10, "bounded");
  assert.equal(applyUnderstandingEvent(passed, { kind: "unavailable" }, now).unavailable_at, now.toISOString());
  assert.equal(normalizeExplanation("a\u0007b\r\nc"), "ab\nc");
});

test("local records live next to the run's preview and round-trip", async () => {
  const id = `d_test_understanding_${process.pid}`;
  try {
    assert.equal(await readUnderstanding("owner", id), null);
    await recordUnderstanding("owner", id, { kind: "passed", text: "Mine." });
    await recordUnderstanding("owner", id, { kind: "practiced" });
    const record = await readUnderstanding("owner", id);
    assert.equal(record?.passed_sha, explanationSha("Mine."));
    assert.equal(record?.practiced, 1);
  } finally { rmSync(path.join(process.cwd(), ".dispatches", id), { recursive: true, force: true }); }
});

test("a run id that is not one is refused", async () => {
  await assert.rejects(recordUnderstanding("owner", "../../x", { kind: "unavailable" }), /Invalid run id/);
  await assert.rejects(readUnderstanding("owner", "../../x"), /Invalid run id/);
});
