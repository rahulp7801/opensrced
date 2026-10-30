import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exchangeOpenRouterCode, openRouterAuthUrl, OpenRouterAuthError, OPENROUTER_KEYS_URL, pkcePair } from "../openrouter";

test("the PKCE pair is fresh each time and the challenge is the S256 of the verifier", () => {
  const a = pkcePair();
  const b = pkcePair();
  assert.notEqual(a.verifier, b.verifier);
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
});

test("the sign-in URL is OpenRouter's, with the callback and an S256 challenge", () => {
  const url = new URL(openRouterAuthUrl("https://opensrcer.example/api/settings/openrouter/callback", "abc_-123"));
  assert.equal(url.origin + url.pathname, "https://openrouter.ai/auth");
  assert.equal(url.searchParams.get("callback_url"), "https://opensrcer.example/api/settings/openrouter/callback");
  assert.equal(url.searchParams.get("code_challenge"), "abc_-123");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

const VERIFIER = "v".repeat(43);

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("the code and verifier are exchanged for the user's key", async () => {
  const { impl, calls } = fakeFetch(200, { key: "sk-or-v1-user", user_id: "u1" });
  assert.equal(await exchangeOpenRouterCode("the-code", VERIFIER, impl), "sk-or-v1-user");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_KEYS_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { code: "the-code", code_verifier: VERIFIER, code_challenge_method: "S256" });
});

for (const [name, status, body] of [
  ["an expired or wrong code (403)", 403, { error: "Invalid code or code_verifier" }],
  ["a server error", 500, {}],
  ["a reply without a key", 200, { user_id: "u1" }],
  ["a key with a line break", 200, { key: "sk-or\nx" }],
] as const) {
  test(`the exchange fails safely on ${name}`, async () => {
    const { impl } = fakeFetch(status, body);
    await assert.rejects(exchangeOpenRouterCode("the-code", VERIFIER, impl), OpenRouterAuthError);
  });
}

test("a missing verifier or a bad code never reaches OpenRouter", async () => {
  const { impl, calls } = fakeFetch(200, { key: "k" });
  await assert.rejects(exchangeOpenRouterCode("the-code", "", impl), /another browser/);
  await assert.rejects(exchangeOpenRouterCode("", VERIFIER, impl), OpenRouterAuthError);
  await assert.rejects(exchangeOpenRouterCode("bad code", VERIFIER, impl), OpenRouterAuthError);
  assert.equal(calls.length, 0);
});

test("a network failure is a named, safe error", async () => {
  const impl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(exchangeOpenRouterCode("the-code", VERIFIER, impl), (error: Error) => error instanceof OpenRouterAuthError && /reach OpenRouter/.test(error.message));
});
