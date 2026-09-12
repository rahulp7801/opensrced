import { test } from "node:test";
import assert from "node:assert/strict";
import { targetTestEnv } from "../crucible/test-runner";

test("target repository tests receive no application credentials", () => {
  const secrets = {
    GITHUB_TOKEN: "github-write-token",
    GH_TOKEN: "gh-write-token",
    ANTHROPIC_API_KEY: "provider-key",
    AUTH0_SECRET: "session-secret",
    GITHUB_APP_PRIVATE_KEY: "app-private-key",
  };
  const original = Object.fromEntries(
    Object.keys(secrets).map((key) => [key, process.env[key]]),
  );

  try {
    Object.assign(process.env, secrets);
    const env = targetTestEnv();
    for (const key of Object.keys(secrets)) {
      assert.equal(env[key], undefined, `${key} must not reach target scripts`);
    }
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
