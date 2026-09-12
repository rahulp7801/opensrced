import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("large dispatch logs return bounded tails and incremental ranges", async () => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-log-reader-"));
  process.chdir(root);
  try {
    mkdirSync(".dispatches");
    const body = "x".repeat(1_000_000) + "ending";
    writeFileSync(".dispatches/d_large.log", body);
    const { readLog, readLogSince } = await import("../dispatcher");

    const tail = readLog("d_large", 16);
    assert.equal(tail, "…(truncated — showing last 16 bytes)…\n" + body.slice(-16));
    assert.deepEqual(readLogSince("d_large", body.length - 6, 16), {
      chunk: "ending",
      size: body.length,
      reset: false,
    });
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
