import { test } from "node:test";
import assert from "node:assert/strict";
import { pollJson } from "../poll-json";

test("API failures surface the server's bounded explanation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: "GitHub suggestions could not be loaded. Check access and rate limits." },
    { status: 503 },
  ));

  await new Promise<void>((resolve) => {
    const stop = pollJson("/suggestions", ({ error }) => {
      assert.equal(error, "GitHub suggestions could not be loaded. Check access and rate limits.");
      stop();
      resolve();
    });
  });
});

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

test("incremental log polling uses the completed response offset", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json({ log_size: 123 });
  });
  let offset = 0;
  await new Promise<void>((resolve) => {
    const stop = pollJson<{ log_size: number }>(() => `/logs?since=${offset}`, ({ data }) => {
      offset = data!.log_size;
      if (urls.length === 2) { stop(); resolve(); }
    }, 1);
  });
  assert.deepEqual(urls, ["/logs?since=0", "/logs?since=123"]);
});
