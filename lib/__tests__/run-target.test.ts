import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunTarget } from "../run-target";

test("run targets preserve dotted repository names and issue numbers", () => {
  assert.deepEqual(parseRunTarget("https://github.com/acme/app.js/issues/12#details"), { repo: "acme/app.js", issue: 12 });
  assert.deepEqual(parseRunTarget("acme/app.js.git"), { repo: "acme/app.js" });
  assert.deepEqual(parseRunTarget("https://github.com/acme/app/"), { repo: "acme/app" });
});

test("run targets reject other hosts, traversal, bad issue numbers and non-strings", () => {
  for (const value of [null, {}, "https://evil.com/acme/app", "https://github.com.evil.com/acme/app", "acme/..", "acme/app/issues/0", "acme/app/issues/1.5", "acme/app/issues/9007199254740992", "acme/app/pull/1"]) {
    assert.throws(() => parseRunTarget(value));
  }
});
