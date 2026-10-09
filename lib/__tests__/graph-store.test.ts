import { test } from "node:test";
import assert from "node:assert/strict";
import { GRAPHS_PER_ACCOUNT, staleGraphPaths } from "../graph-store";

test("an account keeps only its newest graphs, whatever order storage lists them in", () => {
  const blobs = Array.from({ length: GRAPHS_PER_ACCOUNT + 3 }, (_, i) => ({ pathname: `g${i}`, uploadedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }));
  const shuffled = [...blobs].reverse();
  // The three oldest (g0..g2) go, the newest twenty stay.
  assert.deepEqual(staleGraphPaths(shuffled).sort(), ["g0", "g1", "g2"]);
  assert.deepEqual(staleGraphPaths(blobs.slice(0, GRAPHS_PER_ACCOUNT)), []);
});
