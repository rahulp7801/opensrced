import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedFixExpired, validSharedFix } from "../shared-fix";

test("public shared fixes accept only their bounded canonical record", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const fix = {
    id,
    repo: "acme/app",
    pr_number: 12,
    comment_body: "Please handle malformed input.",
    fix_response: "Implemented a bounded parser.",
    diff: "--- a/parser.ts\n+++ b/parser.ts\n",
    explainer: null,
    created_at: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(validSharedFix(fix, id), true);
  for (const changed of [
    { id: "223e4567-e89b-42d3-a456-426614174000" },
    { repo: "https://example.com/acme/app" },
    { pr_number: 0 },
    { fix_response: "" },
    { diff: "x".repeat(10_001) },
    { created_at: "not-a-date" },
  ]) assert.equal(validSharedFix({ ...fix, ...changed }, id), false);
});

test("public shared fixes expire after 30 days", () => {
  const fix = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: "acme/app",
    pr_number: null,
    comment_body: null,
    fix_response: "Fixed.",
    diff: null,
    explainer: null,
    created_at: "2026-09-01T00:00:00.000Z",
  };
  assert.equal(sharedFixExpired(fix, Date.parse("2026-09-30T23:59:59.999Z")), false);
  assert.equal(sharedFixExpired(fix, Date.parse("2026-10-01T00:00:00.000Z")), true);
});
