import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { codexEvents, pipeCodexJson, planUnavailable } from "../codex-events";

// Shapes as emitted by codex-cli 0.164 `exec --json` (see NOTES.md for the capture).
const lines = {
  thread: { type: "thread.started", thread_id: "t" },
  warning: { type: "item.completed", item: { id: "item_0", type: "error", message: "Model metadata not found" } },
  tool: { type: "item.started", item: { id: "item_1", type: "mcp_tool_call", server: "opensrcer-repo-tools", tool: "read_file", arguments: { repo: "acme/app", path: "src/index.ts" }, status: "in_progress" } },
  message: { type: "item.completed", item: { id: "item_2", type: "agent_message", text: "## Diagnosis\nOff by one.\n```diff\n--- a/x\n+++ b/x\n```\n## PR title\nfix: off by one" } },
  done: { type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 300 } },
  limit: { type: "turn.failed", error: { message: "You've hit your usage limit. Try again later." } },
  other: { type: "turn.failed", error: { message: "{\"error\":{\"message\":\"bad request\"}}" } },
};

async function pipe(events: object[]) {
  const stdout = new PassThrough();
  let log = "";
  const state = pipeCodexJson(stdout, { write: (chunk: string) => { log += chunk; return true; } });
  stdout.end(events.map((e) => JSON.stringify(e)).join("\n"));
  await once(stdout, "end");
  return { state, log };
}

test("a completed Codex turn writes the agent's sections and tool calls to the run log", async () => {
  const { state, log } = await pipe([lines.thread, lines.warning, lines.tool, lines.message, lines.done]);
  assert.deepEqual(state, { complete: true, failed: false, unavailable: false });
  assert.match(log, /\[tool\] read_file src\/index\.ts/);
  assert.match(log, /## Diagnosis\nOff by one\./);
  assert.match(log, /```diff\n--- a\/x/);
  assert.match(log, /## PR title\nfix: off by one/);
  assert.match(log, /plan usage: input_tokens=1200 output_tokens=300/);
});

test("a plan limit fails the run and marks the plan unavailable", async () => {
  const { state, log } = await pipe([lines.thread, lines.limit]);
  assert.deepEqual(state, { complete: false, failed: true, unavailable: true });
  assert.match(log, /usage limit/);
});

test("other failures and garbage fail without claiming the plan is unavailable", async () => {
  assert.deepEqual((await pipe([lines.other])).state, { complete: false, failed: true, unavailable: false });
  const { state } = await pipe([lines.message]);
  assert.equal(state.complete, false, "no turn.completed means no completion");
  const noTools = await pipe([lines.thread, lines.message, lines.done]);
  assert.deepEqual(noTools.state, { complete: false, failed: true, unavailable: false }, "a turn without a real tool call is not a result");
  assert.match(noTools.log, /made no repository tool calls/);
  const stdout = new PassThrough();
  const garbage = pipeCodexJson(stdout, { write: () => true });
  stdout.end("not json\n");
  await once(stdout, "end");
  assert.equal(garbage.failed, true);
});

test("codexEvents maps exploration events and ignores noise", () => {
  assert.deepEqual(codexEvents(JSON.stringify(lines.message)), [{ text: lines.message.item.text }]);
  assert.deepEqual(codexEvents(JSON.stringify(lines.tool)), [{ tool: "read_file", detail: "src/index.ts" }]);
  assert.deepEqual(codexEvents(JSON.stringify(lines.done)), [{ done: true }]);
  assert.match(String(codexEvents(JSON.stringify(lines.limit))[0].error), /ChatGPT plan/);
  assert.deepEqual(codexEvents(JSON.stringify(lines.warning)), []);
  assert.deepEqual(codexEvents("{"), []);
});

test("planUnavailable recognises limits and lost logins only", () => {
  for (const message of ["Claude AI usage limit reached|1700000000", "You've hit your limit · resets 5pm", "Not logged in · Please run /login", "OAuth token has expired", "429 rate_limit_error"]) {
    assert.equal(planUnavailable(message), true, message);
  }
  for (const message of ["", "The model declined", "Could not find file"]) assert.equal(planUnavailable(message), false, message);
});
