import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo } from "../safe-return-to";

test("authentication return targets stay on this application", () => {
  assert.equal(safeReturnTo("/issues?repo=acme%2Fapp#scan"), "/issues?repo=acme%2Fapp#scan");
  assert.equal(safeReturnTo(undefined), "/");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil.example"), "/");
  assert.equal(safeReturnTo("/" + "a".repeat(2048)), "/");
  assert.equal(safeReturnTo("/%"), "/");
});
