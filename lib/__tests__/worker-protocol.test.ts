import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertWorkerProtocol, WORKER_PROTOCOL_PATH, WORKER_PROTOCOL_VERSION } from "../worker-protocol";

test("hosted workers reject missing and stale snapshot protocols", async () => {
  assert.equal(readFileSync(".opensrcer-worker-protocol", "utf8").trim(), WORKER_PROTOCOL_VERSION);
  let requestedPath = "";
  await assertWorkerProtocol({
    async readFileToBuffer({ path }) {
      requestedPath = path;
      return Buffer.from("1\n");
    },
  });
  assert.equal(requestedPath, WORKER_PROTOCOL_PATH);

  for (const marker of [null, Buffer.from("0\n")]) {
    await assert.rejects(
      assertWorkerProtocol({ async readFileToBuffer() { return marker; } }),
      /snapshot is incompatible/,
    );
  }
});
