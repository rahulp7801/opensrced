import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStatsFile } from "../stats";

test("activity state recovers from malformed counters and history", () => {
  assert.deepEqual(normalizeStatsFile(null), { scans: 0, discoverRuns: 0, scanHistory: [] });
  assert.deepEqual(normalizeStatsFile({
    scans: "many",
    discoverRuns: -1,
    scanHistory: [
      { ts: "bad", kind: "scan" },
      { ts: "2026-09-12T00:00:00.000Z", kind: "unknown" },
      { ts: "2026-09-12T00:00:00.000Z", kind: "discover", repo: "acme/app" },
    ],
  }), {
    scans: 0,
    discoverRuns: 0,
    scanHistory: [{ ts: "2026-09-12T00:00:00.000Z", kind: "discover", repo: "acme/app" }],
  });
});

test("activity history remains bounded to the newest 200 valid entries", () => {
  const scanHistory = Array.from({ length: 220 }, (_, index) => ({
    ts: new Date(1_750_000_000_000 + index).toISOString(),
    kind: "scan" as const,
  }));
  const state = normalizeStatsFile({ scans: 220, discoverRuns: 0, scanHistory });
  assert.equal(state.scanHistory.length, 200);
  assert.equal(state.scanHistory[0].ts, scanHistory[20].ts);
});
