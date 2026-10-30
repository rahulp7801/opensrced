import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBEDDING_DIMENSIONS } from "../db/schema";
import { EMBED_BATCH, EmbeddingError, VOYAGE_MODEL, VOYAGE_URL, embedTexts, embeddingsEnabled, issueEmbeddingText } from "../recs/embed";

type Call = { url: string; auth: string | null; body: { input: string[]; model: string; input_type: string; output_dimension: number } };

/** Voyage stand-in: one vector per input whose first value is the input's
 *  global position, returned in reverse order to prove we sort by index. */
function fakeVoyage(override?: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  let seen = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
    calls.push(call);
    const custom = override?.(call);
    if (custom) return custom;
    const data = call.body.input.map((_: string, index: number) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      v[0] = seen + index;
      return { embedding: v, index };
    }).reverse();
    seen += call.body.input.length;
    return Response.json({ data, usage: { total_tokens: 1 } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function withKey<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env.VOYAGE_API_KEY;
  if (value === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = value;
  try { return fn(); } finally { if (saved === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = saved; }
}

test("embeddingsEnabled follows VOYAGE_API_KEY at call time", () => {
  assert.equal(withKey(undefined, embeddingsEnabled), false);
  assert.equal(withKey("", embeddingsEnabled), false);
  assert.equal(withKey("pa-test", embeddingsEnabled), true);
});

test("issueEmbeddingText: title plus the first 1.5k characters of the body", () => {
  const text = issueEmbeddingText("Title", "x".repeat(5_000));
  assert.ok(text.startsWith("Title\n\n"));
  assert.equal(text.length, "Title\n\n".length + 1_500);
});

test("embedTexts: batches, keeps order, sends the model and dimensions", async () => {
  const { fetch, calls } = fakeVoyage();
  const texts = Array.from({ length: EMBED_BATCH + 2 }, (_, i) => `issue ${i}`);
  texts[3] = ""; // Voyage rejects empty strings
  const vectors = await embedTexts(texts, { fetch, apiKey: "pa-test" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.body.input.length), [EMBED_BATCH, 2]);
  assert.equal(calls[0].body.input[3], " ");
  assert.equal(calls[0].url, VOYAGE_URL);
  assert.equal(calls[0].auth, "Bearer pa-test");
  assert.deepEqual([calls[0].body.model, calls[0].body.input_type, calls[0].body.output_dimension], [VOYAGE_MODEL, "document", EMBEDDING_DIMENSIONS]);
  assert.deepEqual(vectors.map((v) => v[0]), texts.map((_, i) => i));
});

test("embedTexts: an empty list makes no request", async () => {
  const { fetch, calls } = fakeVoyage();
  assert.deepEqual(await embedTexts([], { fetch, apiKey: "k" }), []);
  assert.equal(calls.length, 0);
});

test("embedTexts: no key, HTTP errors and malformed answers throw EmbeddingError", async () => {
  await withKey(undefined, () => assert.rejects(embedTexts(["a"]), EmbeddingError));
  const failing = fakeVoyage(() => Response.json({ detail: "bad" }, { status: 429 }));
  await assert.rejects(embedTexts(["a"], { fetch: failing.fetch, apiKey: "k" }), /HTTP 429/);
  const short = fakeVoyage(() => Response.json({ data: [] }));
  await assert.rejects(embedTexts(["a"], { fetch: short.fetch, apiKey: "k" }), /wrong number/);
  const small = fakeVoyage(() => Response.json({ data: [{ embedding: [1, 2], index: 0 }] }));
  await assert.rejects(embedTexts(["a"], { fetch: small.fetch, apiKey: "k" }), /wrong size/);
});
