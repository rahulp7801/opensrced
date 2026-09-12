import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudRunLease, isCloudSlotLease } from "../cloud-leases";

test("shared capacity leases reject malformed state instead of wedging workers", () => {
  assert.equal(isCloudSlotLease({ id: "", expires: 0 }), true);
  assert.equal(isCloudSlotLease({ id: "123e4567-e89b-42d3-a456-426614174000", expires: Date.now() + 1_000 }), true);
  for (const value of [null, [], {}, { id: "corrupt", expires: Date.now() + 1_000 }, { id: "", expires: Infinity }]) {
    assert.equal(isCloudSlotLease(value), false);
  }
});

test("agent leases are limited to canonical owner-scoped run paths", () => {
  const path = `users/${"a".repeat(64)}/runs/8232774399999-c_1767225600000_abcdef123456.json`;
  assert.deepEqual(cloudRunLease({ path, expires: 1 }), { path, expires: 1, id: "c_1767225600000_abcdef123456" });
  for (const value of [
    null,
    { path: "users/admin.json", expires: 1 },
    { path: path.replace("8232774399999", "0000000000000"), expires: 1 },
    { path, expires: Number.NaN },
  ]) assert.equal(cloudRunLease(value), null);
});
