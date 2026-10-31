import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_ERROR_COPY, AUTH_ERROR_KINDS, authErrorKind, parseAuthErrorKind } from "../auth-errors";

// Shapes the Auth0 SDK (v4) hands onCallback: SdkError subclasses with a code,
// and AuthorizationError wrapping the provider's OAuth2Error as `cause`.
const authorization = (code: string, message?: string) => ({ code: "authorization_error", cause: { code, message } });

test("callback errors map to a fixed kind", () => {
  const cases: Array<[Parameters<typeof authErrorKind>[0], string]> = [
    [{ code: "missing_state" }, "expired"],
    [{ code: "invalid_state" }, "expired"],
    [{ code: "session_expired" }, "expired"],
    [authorization("access_denied", "User did not authorize the request"), "denied"],
    [authorization("access_denied"), "denied"],
    [authorization("access_denied", "opensrcer is invite-only; you have not been invited"), "invite"],
    [authorization("access_denied", "Not INVITED"), "invite"],
    [authorization("server_error", "invite"), "signin"],
    [{ code: "authorization_code_grant_error" }, "signin"],
    [{ code: "discovery_error" }, "signin"],
    [{}, "signin"],
    [null, "signin"],
    [undefined, "signin"],
    [{ code: 42, cause: "access_denied" }, "signin"],
  ];
  for (const [error, kind] of cases) assert.equal(authErrorKind(error), kind, JSON.stringify(error));
});

test("only known kinds come back from the query string", () => {
  for (const kind of AUTH_ERROR_KINDS) assert.equal(parseAuthErrorKind(kind), kind);
  for (const bad of [undefined, "", "DENIED", "denied ", "<script>", "toString", "__proto__"]) assert.equal(parseAuthErrorKind(bad), null, String(bad));
});

test("every kind has a title and a body", () => {
  for (const kind of AUTH_ERROR_KINDS) {
    assert.ok(AUTH_ERROR_COPY[kind].title.length > 0);
    assert.ok(AUTH_ERROR_COPY[kind].body.length > 0);
  }
});
