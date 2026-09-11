import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicStream } from "../anthropic-stream";

function providerStream(events: unknown[]) { return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")); }

test("text streaming reports usage and releases capacity exactly once", async (t) => {
  let releases = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.ok(options.signal);
    return providerStream([
      { type: "message_start", message: { usage: { input_tokens: 100 } } },
      { type: "content_block_delta", delta: { text: "A reply" } },
      { type: "message_delta", usage: { output_tokens: 10 } },
      { type: "message_stop" },
    ]);
  });
  const response = anthropicStream("test-key", "system", "user", 300, new AbortController().signal, () => releases++);
  const body = await response.text();
  assert.ok(body.includes('"text":"A reply"'));
  assert.ok(body.includes('"cost":0.00015'));
  assert.ok(body.includes('"done":true'));
  assert.equal(releases, 1);
});

test("provider errors and truncated output never report successful completion", async (t) => {
  for (const events of [[{ type: "error" }], [{ type: "content_block_delta", delta: { text: "partial" } }]]) {
    const mock = t.mock.method(globalThis, "fetch", async () => providerStream(events));
    const body = await anthropicStream("test-key", "system", "user", 300, new AbortController().signal).text();
    assert.ok(body.includes('"error":'));
    assert.ok(!body.includes('"done":true'));
    mock.mock.restore();
  }
});

test("cancelling the browser stream aborts the provider request and frees capacity", async (t) => {
  let released = false;
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }));
  const response = anthropicStream("test-key", "system", "user", 300, new AbortController().signal, () => { released = true; });
  await response.body!.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(released, true);
});
