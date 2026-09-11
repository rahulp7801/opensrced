import { test } from "node:test";
import assert from "node:assert/strict";
import { pollJson } from "../poll-json";

test("cleanup aborts a request and a remount starts immediately", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", (_url: string, opts: RequestInit) => {
    signals.push(opts.signal!);
    return new Promise((_resolve, reject) => opts.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  let results = 0;
  const first = pollJson("/stats", () => results++);
  first();
  const second = pollJson("/stats", () => results++);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  second();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(results, 0);
});

test("a hung request times out and polling never overlaps", async (t) => {
  let active = 0;
  let peak = 0;
  t.mock.method(globalThis, "fetch", (_url: string, opts: RequestInit) => {
    peak = Math.max(peak, ++active);
    return new Promise((_resolve, reject) => opts.signal!.addEventListener("abort", () => {
      active--;
      reject(new Error("aborted"));
    }));
  });
  await new Promise<void>((resolve) => {
    let count = 0;
    const stop = pollJson("/stats", (result) => {
      assert.match(result.error!, /timed out/);
      if (++count === 2) { stop(); resolve(); }
    }, 1, 10);
  });
  assert.equal(peak, 1);
  assert.equal(active, 0);
});
