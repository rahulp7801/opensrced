import { test } from "node:test";
import assert from "node:assert/strict";
import { newSharedFixId, SHARED_FIX_RETENTION_MS, sharedFixExpired, sharedFixOwnerPrefix, sharedFixPath, staleSharedFixPaths, validSharedFix } from "../shared-fix";

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

test("current share IDs are unguessable, owner-scoped, and resolve without a session", () => {
  const now = Date.parse("2026-09-12T00:00:00.000Z");
  const id = newSharedFixId("auth0|alice", now, Buffer.alloc(16, 0xab));
  assert.match(id, /^s_\d{13}_[a-f0-9]{32}_[a-f0-9]{32}$/);
  assert.equal(sharedFixPath(id), `${sharedFixOwnerPrefix("auth0|alice")}8210828799999-${id}.json`);
  assert.notEqual(sharedFixOwnerPrefix("auth0|alice"), sharedFixOwnerPrefix("auth0|bob"));
  assert.equal(sharedFixPath("../../secret"), null);
});

test("cloud share retention selects only expired and excess records for one owner", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const ids = Array.from({ length: 905 }, (_, index) =>
    newSharedFixId("alice", start + index, Buffer.alloc(16, index % 256)));
  const paths = ids.map((id) => sharedFixPath(id)!);
  const stale = staleSharedFixPaths("alice", [
    ...paths.reverse(),
    sharedFixPath(newSharedFixId("bob", start, Buffer.alloc(16, 1)))!,
    `${sharedFixOwnerPrefix("alice")}not-a-share.json`,
  ], start + SHARED_FIX_RETENTION_MS - 1, 900, 100);
  assert.deepEqual(stale, ids.slice(0, 5).map((id) => sharedFixPath(id)!));
});
