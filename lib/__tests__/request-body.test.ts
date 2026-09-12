import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../request-body";

test("JSON request bodies are parsed within a hard byte limit", async () => {
  const valid = new Request("http://localhost", { method: "POST", body: JSON.stringify({ ok: true }) });
  assert.deepEqual(await readJsonBody(valid, 100), { ok: true });

  const declaredLarge = new Request("http://localhost", { method: "POST", headers: { "content-length": "101" }, body: "{}" });
  assert.equal(await readJsonBody(declaredLarge, 100), null);

  const streamedLarge = new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`{"value":"${"x".repeat(100)}"}`)); controller.close(); } }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(await readJsonBody(streamedLarge, 50), null);
  assert.equal(await readJsonBody(new Request("http://localhost", { method: "POST", body: "{" })), null);
});
