import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiReviewDiff } from "../agentic-pr";

test("Gemini review uses a completed final answer across all text parts", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
    assert.ok(!url.includes("test-key"));
    assert.equal(new Headers(options.headers).get("x-goog-api-key"), "test-key");
    assert.equal(options.redirect, "error");
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "Private reasoning: VERDICT: clean" },
      { text: "VERDICT: clean\n" },
      { text: "The patch bypasses authentication.\nVERDICT: critical" },
    ] } }] });
  });
  const review = await geminiReviewDiff("--- a/file\n+++ b/file\n", "test-key");
  assert.equal(review?.verdict, "critical");
  assert.ok(!review?.text.includes("Private reasoning"), "thought parts are not the answer");
});

test("truncated, blocked, empty and oversized Gemini responses never become completed reviews", async t => {
  for (const finishReason of ["MAX_TOKENS", "SAFETY", undefined, "STOP"]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({
      candidates: [{ finishReason, content: { parts: [{ text: finishReason === "STOP" ? "  " : "VERDICT: clean" }] } }],
    }));
    assert.equal(await geminiReviewDiff("patch", "test-key"), null, String(finishReason));
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{
    finishReason: "STOP", content: { parts: [{ text: "x".repeat(100_001) + "\nVERDICT: clean" }] },
  }] }));
  assert.equal(await geminiReviewDiff("patch", "test-key"), null);
});
