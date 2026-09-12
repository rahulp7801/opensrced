import { test } from "node:test";
import assert from "node:assert/strict";
import { githubApi, githubGraphql, githubResponse } from "../github-api";
import { sanitizePrNumber } from "../sanitize";
import { listIssues } from "../issues";
import { discover } from "../discover";

test("PR numbers reject partial strings, fractions and unsafe integers", () => {
  for (const value of ["12junk", "1/../../user", "1.5", 1.5, 0, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(sanitizePrNumber(value), null);
  assert.equal(sanitizePrNumber("1234567"), 1234567);
});

test("GitHub diff responses preserve text and request the diff media type", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("Accept"), "application/vnd.github.diff");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-user-token");
    return new Response("diff --git a/file b/file\n");
  });
  assert.equal(await (await githubResponse("/repos/acme/app/pulls/1", "test-user-token", undefined, "application/vnd.github.diff")).text(), "diff --git a/file b/file\n");
});

test("GitHub requests use caller credentials, a deadline, and reject redirects", async (t) => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    requests.push(options);
    return Response.json({ ok: true });
  });
  await githubApi("/user", "test-user-token");
  await githubApi("/repos/acme/app");
  assert.equal(new Headers(requests[0].headers).get("Authorization"), "Bearer test-user-token");
  assert.equal(new Headers(requests[1].headers).has("Authorization"), false);
  assert.equal(requests[0].redirect, "error");
  assert.ok(requests[0].signal);
  await assert.rejects(githubApi("//evil.example"), /Invalid/);
});

test("GitHub failures are not reported as successful empty issue scans", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "private upstream details" }, { status: 403 }));
  await assert.rejects(listIssues("acme", "app"), /rate limit/);
});

test("GraphQL errors are rejected even with HTTP 200", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "denied" }] }));
  await assert.rejects(githubGraphql("query {}", {}, "test-token"), /could not complete/);
});

test("anonymous issue scans filter PRs and retain comment counts", async (t) => {
  const issue = { number: 1, title: "Fix typo in README", body: "A documentation typo", labels: ["documentation"],
    state: "open", user: { login: "alice" }, html_url: "https://github.com/acme/app/issues/1",
    created_at: "2026-09-01", updated_at: "2026-09-01", assignees: [], comments: 12 };
  t.mock.method(globalThis, "fetch", async () => Response.json([issue, { ...issue, number: 2, pull_request: {} }]));
  const issues = await listIssues("acme", "app");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].comments, 12);
});

test("issue scans bound GitHub concurrency and label payloads", async (t) => {
  let active = 0;
  let peak = 0;
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    urls.push(String(input));
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return Response.json([]);
  });

  await listIssues("acme", "app", 50, ["good first issue", "beginner", "starter", "easy", "first-timers-only"]);

  assert.equal(urls.length, 6);
  assert.equal(peak, 3);
  assert.equal(urls.filter(url => url.includes("per_page=20")).length, 5);
  assert.equal(urls.filter(url => url.includes("per_page=50")).length, 1);
});

test("discovery carries the caller token through search and issue queries", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    urls.push(url);
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-user-token");
    return url.includes("/graphql")
      ? Response.json({ data: { repository: { issues: { nodes: [] } } } })
      : Response.json({ items: [{ full_name: "acme/app", owner: { login: "acme" }, name: "app", open_issues_count: 1 }] });
  });
  await discover({ minStars: 10 }, "test-user-token");
  assert.equal(urls.length, 2);
});

test("caller cancellation stops an in-flight GitHub request", async (t) => {
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  }));
  const controller = new AbortController();
  const request = githubApi("/search/issues?q=bug", "test-token", undefined, controller.signal);
  controller.abort(new Error("request cancelled"));
  await assert.rejects(request, /request cancelled/);
});

test("discovery cancellation stops queued scans and preserves completed results", { timeout: 2000 }, async (t) => {
  let calls = 0, active = 0, peak = 0;
  let started!: () => void;
  const busy = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", (url: string, options: RequestInit) => {
    if (!url.includes("/graphql")) return Promise.resolve(Response.json({ items: Array.from({ length: 10 }, (_, i) => ({ full_name: `acme/app${i}`, owner: { login: "acme" }, name: `app${i}`, open_issues_count: 1 })) }));
    calls++;
    if (calls === 1) return Promise.resolve(Response.json({ data: { repository: { issues: { nodes: [] } } } }));
    peak = Math.max(peak, ++active);
    if (calls === 5) started();
    return new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => { active--; reject(options.signal!.reason); }, { once: true });
    });
  });
  const controller = new AbortController();
  const result = discover({ minStars: 10, repoLimit: 10 }, "test-token", controller.signal);
  await busy;
  controller.abort();
  const partial = await result;
  assert.equal(calls, 5, "the five queued repositories must not start after cancellation");
  assert.equal(active, 0);
  assert.equal(peak, 4);
  assert.ok(partial.warnings.some(warning => warning.includes("5 repositories were not scanned")));
});
