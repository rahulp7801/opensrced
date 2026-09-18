import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonBody, readTextBody } from "../request-body";

test("JSON request bodies are parsed within a hard byte limit", async () => {
  const valid = new Request("http://localhost", { method: "POST", body: JSON.stringify({ ok: true }) });
  assert.deepEqual(await readJsonBody(valid, 100), { ok: true });
  assert.equal(await readJsonBody(new Request("http://localhost", { method: "POST", body: "null" })), null);

  const declaredLarge = new Request("http://localhost", { method: "POST", headers: { "content-length": "101" }, body: "{}" });
  assert.equal(await readJsonBody(declaredLarge, 100), null);

  const streamedLarge = new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`{"value":"${"x".repeat(100)}"}`)); controller.close(); } }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(await readJsonBody(streamedLarge, 50), null);
  assert.equal(await readJsonBody(new Request("http://localhost", { method: "POST", body: "{" })), null);
  assert.equal(await readTextBody(new Request("http://localhost", { method: "POST", body: "signed payload" }), 20), "signed payload");
  assert.equal(await readTextBody(new Request("http://localhost", { method: "POST", body: "too large" }), 4), null);
});

test("bounded provider JSON reading releases its response stream on success and overflow", async () => {
  const valid = Response.json({ ok: true });
  assert.deepEqual(await readJsonBody(valid, 100), { ok: true });
  assert.equal(valid.body!.locked, false);
  let cancelled = false;
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(101))); },
    cancel() { cancelled = true; },
  }));
  assert.equal(await readJsonBody(oversized, 100), null);
  assert.equal(cancelled, true);
  assert.equal(oversized.body!.locked, false);
  cancelled = false;
  const declaredOversized = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "101" } });
  assert.equal(await readJsonBody(declaredOversized, 100), null);
  assert.equal(cancelled, true, "declared overflow must cancel rather than leave an unread provider body");
});
