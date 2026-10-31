import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo, signInHref } from "../safe-return-to";

test("authentication return targets stay on this application", () => {
  assert.equal(safeReturnTo("/issues?repo=acme%2Fapp#scan"), "/issues?repo=acme%2Fapp#scan");
  assert.equal(safeReturnTo(undefined), "/");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil.example"), "/");
  assert.equal(safeReturnTo("/" + "a".repeat(2048)), "/");
  assert.equal(safeReturnTo("/%"), "/");
  for (const dotted of ["/.//evil.example", "/..//evil.example", "/%2e//evil.example"]) {
    assert.equal(safeReturnTo(dotted), "/", dotted);
  }
});

test("sign-in links go straight to GitHub and back to a safe page", () => {
  assert.equal(signInHref("/issues?repo=a%2Fb"), "/auth/login?connection=github&returnTo=%2Fissues%3Frepo%3Da%252Fb");
  for (const unsafe of [undefined, "", "https://evil.example", "//evil.example", "/.//evil.example"]) {
    assert.equal(signInHref(unsafe), "/auth/login?connection=github&returnTo=%2F", String(unsafe));
  }
});
