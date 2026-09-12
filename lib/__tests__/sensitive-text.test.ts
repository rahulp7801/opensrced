import { test } from "node:test";
import assert from "node:assert/strict";
import { sensitiveTextKind } from "../sensitive-text";

test("public fix content detects provider tokens without echoing their values", () => {
  const github = "gh" + "p_" + "a".repeat(36);
  const anthropic = "sk" + "-ant-api03-" + "b".repeat(32);
  const google = "AI" + "za" + "c".repeat(35);
  assert.equal(sensitiveTextKind([`- TOKEN=${github}`]), "GitHub token");
  assert.equal(sensitiveTextKind([null, anthropic]), "Anthropic key");
  assert.equal(sensitiveTextKind([google, undefined]), "Google API key");
});

test("public fix content allows code and obvious credential placeholders", () => {
  assert.equal(sensitiveTextKind([
    "const token = process.env.GITHUB_TOKEN;",
    "sk-ant-api03-...",
    "ghp_example",
    "-----BEGIN PUBLIC KEY-----",
  ]), null);
});
