import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { prepareSession, GITHUB_TOKEN_CLAIM } from "../auth-session";

const session = (user: SessionData["user"]): SessionData => ({ user, tokenSet: { accessToken: "test-auth0-value", expiresAt: 123 }, internal: { sid: "session-1", createdAt: 1 } });

test("GitHub claims survive session filtering without appearing in the browser profile", async () => {
  const input = session({ sub: "alice", name: "Alice", [GITHUB_TOKEN_CLAIM]: "test-github-value", exp: 123 });
  const result = await prepareSession(input);
  assert.equal(result.githubToken, "test-github-value");
  assert.deepEqual(result.user, { sub: "alice", name: "Alice" });
  assert.deepEqual(result.tokenSet, input.tokenSet);
  assert.deepEqual(result.internal, input.internal);
  assert.equal(input.user[GITHUB_TOKEN_CLAIM], "test-github-value", "do not mutate the SDK input");
});

test("session refresh preserves the private token and rejects invalid claims", async () => {
  assert.equal((await prepareSession({ ...session({ sub: "alice" }), githubToken: "test-github-value" })).githubToken, "test-github-value");
  for (const value of [123, {}, "", "line\nbreak", "x".repeat(1025)]) {
    const result = await prepareSession(session({ sub: "alice", [GITHUB_TOKEN_CLAIM]: value }));
    assert.equal(result.githubToken, undefined);
    assert.equal(GITHUB_TOKEN_CLAIM in result.user, false);
  }
});
