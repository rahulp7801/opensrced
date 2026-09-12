import { test } from "node:test";
import assert from "node:assert/strict";
import { authConfigured } from "../auth-config";

const complete = {
  AUTH0_SECRET: "secret",
  AUTH0_DOMAIN: "example.auth0.com",
  APP_BASE_URL: "https://example.com",
  AUTH0_CLIENT_ID: "client",
  AUTH0_CLIENT_SECRET: "client-secret",
};

test("Auth0 readiness requires every server-side setting", () => {
  assert.equal(authConfigured(complete), true);
  for (const key of Object.keys(complete)) {
    assert.equal(authConfigured({ ...complete, [key]: undefined }), false, key);
  }
});

test("Auth0 readiness accepts supported legacy and assertion settings", () => {
  assert.equal(authConfigured({
    AUTH0_SECRET: "secret",
    AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
    AUTH0_BASE_URL: "https://example.com",
    AUTH0_CLIENT_ID: "client",
    AUTH0_CLIENT_ASSERTION_SIGNING_KEY: "key",
  }), true);
});
