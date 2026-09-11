import { test } from "node:test";
import assert from "node:assert/strict";
import { readTextResponse } from "../sse";

const stream = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
test("text responses publish progress and require a completed, nonempty result", async () => {
  const progress: string[] = [];
  assert.equal(await readTextResponse(stream([{ text: "a" }, { text: "b" }, { done: true }]), text => progress.push(text)), "ab");
  assert.deepEqual(progress, ["a", "ab"]);
  assert.equal(await readTextResponse(Response.json({ result: "reply" }), () => {}), "reply");
  for (const response of [stream([{ text: "partial" }]), stream([{ done: true }]), Response.json({})]) {
    await assert.rejects(readTextResponse(response, () => {}), /completion|Empty response/);
  }
  await assert.rejects(readTextResponse(stream([{ text: "partial" }, { error: "Provider failed" }]), () => {}), /Provider failed/);
  await assert.rejects(readTextResponse(Response.json({ error: "Key required" }, { status: 400 }), () => {}), /Key required/);
});
