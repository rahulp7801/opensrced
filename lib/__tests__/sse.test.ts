import { test } from "node:test";
import assert from "node:assert/strict";
import { sseEvents } from "../sse";

test("stopping a stream consumer cancels its upstream reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data:{"text":"hello"}\r\n\r\n')); },
    cancel() { cancelled = true; },
  });
  for await (const event of sseEvents<{ text: string }>(new Response(stream))) {
    assert.equal(event.text, "hello");
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("unbounded event data fails and releases the response", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(1_000_001))); c.close(); } });
  await assert.rejects(async () => { for await (const event of sseEvents(new Response(stream))) void event; }, /size limit/);
  assert.equal(stream.locked, false);
});
