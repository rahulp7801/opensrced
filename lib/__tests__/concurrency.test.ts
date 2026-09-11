import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSlots, reserveSlot, CapacityError } from "../concurrency";

test("capacity is bounded and duplicate cleanup cannot release another task", () => {
  const releases = Array.from({ length: 3 }, () => reserveSlot("test", 3));
  for (let i = 0; i < 500; i++) assert.throws(() => reserveSlot("test", 3), CapacityError);
  assert.equal(activeSlots("test"), 3);
  releases[0]();
  releases[0]();
  assert.equal(activeSlots("test"), 2);
  const replacement = reserveSlot("test", 3);
  releases.forEach((release) => release());
  replacement();
  assert.equal(activeSlots("test"), 0);
});
