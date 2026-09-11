import { test } from "node:test";
import assert from "node:assert/strict";
import { sealKeys, openKeys, validStoredKeys, KEY_COOKIE_SECONDS } from "../key-cookie";

const secret = "unit-test-encryption-secret";
const keys = { anthropic: "test-provider-value", maxSpendUsd: 2 };

test("API key cookies are encrypted, randomized and bound to one account", () => {
  const cookie = sealKeys(keys, "alice", secret);
  assert.deepEqual(openKeys(cookie, "alice", secret), keys);
  assert.deepEqual(openKeys(cookie, "bob", secret), {});
  assert.deepEqual(openKeys(cookie, "", secret), {});
  assert.deepEqual(openKeys(cookie, "alice", "wrong-secret"), {});
  assert.notEqual(cookie, sealKeys(keys, "alice", secret));
  assert.equal(Buffer.from(cookie, "base64url").includes(Buffer.from(keys.anthropic)), false);
});

test("modified, oversized and expired API key cookies fail closed", (t) => {
  const cookie = sealKeys(keys, "alice", secret);
  const modified = Buffer.from(cookie, "base64url");
  modified[modified.length - 1] ^= 1;
  assert.deepEqual(openKeys(modified.toString("base64url"), "alice", secret), {});
  assert.deepEqual(openKeys("x".repeat(4000), "alice", secret), {});
  assert.deepEqual(openKeys("invalid", "alice", secret), {});
  const future = Date.now() + (KEY_COOKIE_SECONDS + 1) * 1000;
  t.mock.method(Date, "now", () => future);
  assert.deepEqual(openKeys(cookie, "alice", secret), {});
});

test("key settings reject invalid types, control characters and unbounded budgets", () => {
  for (const value of [null, [], { anthropic: {} }, { gemini: "line\nbreak" }, { anthropic: "x".repeat(513) }, { maxSpendUsd: Infinity }, { maxSpendUsd: -1 }, { maxSpendUsd: 11 }, { maxSpendUsd: "2" }]) {
    assert.equal(validStoredKeys(value), false);
  }
  for (const value of [{}, { anthropic: "" }, keys, { maxSpendUsd: 0.5 }, { maxSpendUsd: 10 }]) assert.equal(validStoredKeys(value), true);
});
