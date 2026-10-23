import { test } from "node:test";
import assert from "node:assert/strict";
import {
  choosePayment, claudeStatusFrom, codexStatusFrom, DEFAULT_ORDER, hostLoginsAllowed, hostedSubscriptionEnabled,
  NoRunCredentialError, normalizeOrder, offeredProviders, type Availability,
} from "../run-payment";

const ALL = [...DEFAULT_ORDER];
const signedIn: Availability = {
  "claude-subscription": { available: true, detail: "signed in to Claude (max plan)" },
  "codex-subscription": { available: true, detail: "signed in with ChatGPT" },
};
const signedOut: Availability = {
  "claude-subscription": { available: false, detail: "not signed in (run `claude auth login`)" },
  "codex-subscription": { available: false, detail: "not signed in (run `codex login`)" },
};

test("the subscription pays first, and the key rides along only when the fallback is on", () => {
  assert.deepEqual(choosePayment({ order: ALL, keyFallback: false }, ALL, signedIn, "key"), { provider: "claude-subscription", keyFallback: false });
  assert.deepEqual(choosePayment({ order: ALL, keyFallback: true }, ALL, signedIn, "key"), { provider: "claude-subscription", keyFallback: true, anthropicKey: "key" });
  assert.deepEqual(choosePayment({ order: ALL, keyFallback: true }, ALL, signedIn, null), { provider: "claude-subscription", keyFallback: false });
});

test("the user's order is honoured, skipping what is not signed in", () => {
  const codexFirst = choosePayment({ order: ["codex-subscription", "claude-subscription", "anthropic-key"], keyFallback: false }, ALL, signedIn, null);
  assert.equal(codexFirst.provider, "codex-subscription");
  const onlyCodex = choosePayment({ order: ALL, keyFallback: false }, ALL, { ...signedOut, "codex-subscription": signedIn["codex-subscription"] }, null);
  assert.equal(onlyCodex.provider, "codex-subscription");
});

test("a key ranked first pays directly; a key ranked after a subscription needs the opt-in", () => {
  assert.deepEqual(choosePayment({ order: ["anthropic-key", ...ALL], keyFallback: false }, ALL, signedIn, "key"), { provider: "anthropic-key", anthropicKey: "key", keyFallback: false });
  assert.deepEqual(choosePayment({ order: ALL, keyFallback: true }, ALL, signedOut, "key"), { provider: "anthropic-key", anthropicKey: "key", keyFallback: true });
  assert.throws(() => choosePayment({ order: ALL, keyFallback: false }, ALL, signedOut, "key"), (error: Error) =>
    error instanceof NoRunCredentialError && /Use my API key when my plan is unavailable/.test(error.message) && /claude auth login/.test(error.message));
});

test("with no subscription offered (hosted, gate off) the key is the only method", () => {
  assert.equal(choosePayment({ order: ALL, keyFallback: false }, ["anthropic-key"], {}, "key").provider, "anthropic-key");
  assert.throws(() => choosePayment({ order: ALL, keyFallback: false }, ["anthropic-key"], {}, null), (error: Error) =>
    error instanceof NoRunCredentialError && /No Anthropic API key configured/.test(error.message));
});

test("nothing signed in and no key fails with what to do", () => {
  assert.throws(() => choosePayment({ order: ALL, keyFallback: true }, ALL, signedOut, null), (error: Error) =>
    error instanceof NoRunCredentialError && /add an Anthropic API key/.test(error.message));
  assert.throws(() => choosePayment({ order: ALL, keyFallback: false }, ALL, {}, null), NoRunCredentialError);
});

test("normalizeOrder keeps known providers once and appends the rest", () => {
  assert.deepEqual(normalizeOrder(["anthropic-key", "anthropic-key", "bogus"]), ["anthropic-key", "claude-subscription", "codex-subscription"]);
  assert.deepEqual(normalizeOrder(undefined), ALL);
  assert.deepEqual(normalizeOrder("claude-subscription"), ALL);
});

test("only a claude.ai login counts as a Claude subscription", () => {
  assert.deepEqual(claudeStatusFrom(0, '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"x@y.z"}'), { available: true, detail: "signed in to Claude (max plan)" });
  assert.equal(claudeStatusFrom(0, '{"loggedIn":true,"authMethod":"console"}').available, false);
  assert.match(claudeStatusFrom(1, '{"loggedIn":false}').detail, /not signed in/);
  assert.match(claudeStatusFrom(-1, "").detail, /not installed/);
  assert.equal(claudeStatusFrom(0, "garbage").available, false);
  assert.match(claudeStatusFrom(0, '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"<b>"}').detail, /unknown plan/);
});

test("only a ChatGPT login counts as a ChatGPT subscription", () => {
  assert.equal(codexStatusFrom(0, "Logged in using ChatGPT\n").available, true);
  assert.match(codexStatusFrom(0, "Logged in using an API key - sk-***\n").detail, /API key/);
  assert.match(codexStatusFrom(1, "Not logged in\n").detail, /codex login/);
  assert.match(codexStatusFrom(-1, "").detail, /not installed/);
});

test("host logins are offered only where the operator is the user", () => {
  const saved = { ...process.env };
  const env = process.env as Record<string, string | undefined>;
  try {
    for (const key of ["VERCEL", "OPENSRCER_EXECUTION", "AUTH_DISABLED", "OPENSRCER_LOCAL_SUBSCRIPTION", "OPENSRCER_HOSTED_SUBSCRIPTION"]) delete env[key];
    env.NODE_ENV = "test";
    assert.equal(hostLoginsAllowed(), false, "a multi-user deployment never bills the host's plan");
    assert.deepEqual(offeredProviders(), ["anthropic-key"]);
    env.AUTH_DISABLED = "1";
    assert.equal(hostLoginsAllowed(), true);
    assert.deepEqual(offeredProviders(), ALL);
    env.NODE_ENV = "production";
    assert.equal(hostLoginsAllowed(), false);
    env.OPENSRCER_LOCAL_SUBSCRIPTION = "1";
    assert.equal(hostLoginsAllowed(), true, "single-user self-host opt-in");
    env.VERCEL = "1";
    assert.equal(hostLoginsAllowed(), false, "never on hosted execution");
    assert.equal(hostedSubscriptionEnabled(), false);
    env.OPENSRCER_HOSTED_SUBSCRIPTION = "1";
    assert.equal(hostedSubscriptionEnabled(), true);
    assert.deepEqual(offeredProviders(), ["claude-subscription", "anthropic-key"], "hosted ChatGPT stays off");
  } finally {
    for (const key of Object.keys(env)) if (!(key in saved)) delete env[key];
    Object.assign(env, saved);
  }
});
