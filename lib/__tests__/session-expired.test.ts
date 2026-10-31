import { test } from "node:test";
import assert from "node:assert/strict";
import { isExpiredSession, watchUnauthorized } from "../session-expired";

const ORIGIN = "https://app.example";

test("only a 401 from this app's own API counts", () => {
  const cases: Array<[RequestInfo | URL, number, boolean]> = [
    ["/api/dispatches", 401, true],
    [`${ORIGIN}/api/me`, 401, true],
    [new URL("/api/repos/github?tab=owned", ORIGIN), 401, true],
    [new Request(`${ORIGIN}/api/issues/scan`), 401, true],
    ["/api/dispatches", 403, false],
    ["/api/dispatches", 200, false],
    ["/api/dispatches", 500, false],
    ["/auth/profile", 401, false],
    ["/discover", 401, false],
    ["https://api.github.com/api/user", 401, false],
    ["//evil.example/api/x", 401, false],
    ["/apix", 401, false],
  ];
  for (const [input, status, expected] of cases) assert.equal(isExpiredSession(input, status, ORIGIN), expected, `${String(input)} ${status}`);
});

test("the wrapper passes responses through and reports each 401", async () => {
  let calls = 0;
  const statuses: Record<string, number> = { "/api/a": 401, "/api/b": 200, "/other": 401 };
  const fake = (async (input: RequestInfo | URL) => new Response(null, { status: statuses[String(input)] })) as typeof fetch;
  const wrapped = watchUnauthorized(fake, ORIGIN, () => { calls++; });
  assert.equal((await wrapped("/api/b")).status, 200);
  assert.equal(calls, 0);
  assert.equal((await wrapped("/api/a")).status, 401);
  assert.equal((await wrapped("/other")).status, 401);
  assert.equal(calls, 1);
});

test("a failed fetch still rejects, without a report", async () => {
  let calls = 0;
  const failing = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  await assert.rejects(watchUnauthorized(failing, ORIGIN, () => { calls++; })("/api/a"), TypeError);
  assert.equal(calls, 0);
});
