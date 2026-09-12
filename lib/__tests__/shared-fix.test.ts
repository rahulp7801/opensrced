import { test } from "node:test";
import assert from "node:assert/strict";
import { validSharedFix } from "../shared-fix";

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
