import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeEvents } from "../claude-events";

test("exploration forwards text and read-only tool progress without raw inputs", () => {
  assert.deepEqual(claudeEvents(JSON.stringify({ type: "assistant", message: { content: [
    { type: "tool_use", name: "mcp__opensrcer-repo-tools__read_file", input: { path: "src/main.ts", unrelated: "private metadata" } },
    { type: "text", text: "The entry point is here." },
  ] } })), [{ tool: "read_file", detail: "src/main.ts" }, { text: "The entry point is here." }]);
});

test("provider failures are visible even when the CLI emits a result", () => {
  const events = claudeEvents(JSON.stringify({ type: "result", is_error: true, total_cost_usd: 0.01, result: "internal provider details" }));
  assert.deepEqual(events[0], { cost: 0.01 });
  assert.equal(typeof events[1].error, "string");
  assert.ok(!JSON.stringify(events).includes("internal provider details"));
});

test("malformed and unrelated Claude events do not interrupt streaming", () => {
  for (const line of ["not json", "null", "{}", '{"type":"assistant","message":{"content":false}}']) assert.deepEqual(claudeEvents(line), []);
});
