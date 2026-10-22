import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunTarget } from "../run-target";

test("run targets preserve dotted repository names and issue numbers", () => {
  assert.deepEqual(parseRunTarget("https://github.com/acme/app.js/issues/12#details"), { repo: "acme/app.js", issue: 12 });
  assert.deepEqual(parseRunTarget("acme/app.js.git"), { repo: "acme/app.js" });
  assert.deepEqual(parseRunTarget("https://github.com/acme/app/"), { repo: "acme/app" });
  // The forms people actually paste.
  for (const value of ["github.com/acme/app", "http://github.com/acme/app", "https://www.github.com/acme/app", "https://GitHub.com/acme/app", " acme/app "]) {
    assert.deepEqual(parseRunTarget(value), { repo: "acme/app" }, value);
  }
});

test("run targets reject owners GitHub would not allow", () => {
  for (const value of ["gitlab.com/acme", "github.com/acme", "example.com/acme/app", ".acme/app", "-acme/app", `${"a".repeat(40)}/app`, "acme.git/app"]) {
    assert.throws(() => parseRunTarget(value), Error, value);
  }
  assert.deepEqual(parseRunTarget(`${"a".repeat(39)}/app`), { repo: `${"a".repeat(39)}/app` });
});

test("run targets reject other hosts, traversal, bad issue numbers and non-strings", () => {
  for (const value of [null, {}, "https://evil.com/acme/app", "https://github.com.evil.com/acme/app", "acme/..", "acme/app/issues/0", "acme/app/issues/1.5", "acme/app/issues/9007199254740992", "acme/app/pull/1"]) {
    assert.throws(() => parseRunTarget(value));
  }
});
