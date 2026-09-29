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

    // Cloud records need an exact suffix: no marker, no split characters.
    const { readLogTail } = await import("../dispatcher");
    const euro = Buffer.from("€"); // 3 bytes
    writeFileSync(".dispatches/d_utf8.log", Buffer.concat([Buffer.from("ab"), euro, Buffer.from("cd"), euro.subarray(0, 2)]));
    const cut = readLogTail("d_utf8", 6); // starts mid "€", ends mid "€"
    assert.deepEqual(cut, { chunk: "cd", size: 7 });
    assert.ok(Buffer.byteLength(cut.chunk) <= cut.size);
    assert.deepEqual(readLogTail("d_large", 16), { chunk: body.slice(-16), size: body.length });
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
