import { test } from "node:test";
import assert from "node:assert/strict";
import { gh, graphqlPaginate } from "../gh";

type Call = { url: string; headers: Record<string, string>; body?: unknown };

/** A fake fetch that answers each request with the next canned response. */
function fakeFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json", ...next.headers } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const secondaryLimit = (retryAfter: string) => ({ status: 403, body: { message: "You have exceeded a secondary rate limit." }, headers: { "retry-after": retryAfter } });

test("gh: a client per token that authenticates as that token", async () => {
  const { fetch, calls } = fakeFetch([{ body: { login: "ada" } }]);
  const { data } = await gh("gho_abc", { fetch }).request("GET /user");
  assert.deepEqual(data, { login: "ada" });
  assert.equal(calls[0].url, "https://api.github.com/user");
  assert.equal(calls[0].headers.authorization, "token gho_abc");
  assert.match(calls[0].headers["user-agent"], /^opensrcer/);
});

test("gh: refuses to build a client without a token", () => {
  for (const token of ["", undefined as unknown as string]) assert.throws(() => gh(token), /GitHub token is required/);
});

test("gh: REST pagination follows Link headers", async () => {
  const next = { link: '<https://api.github.com/repositories/1/issues?page=2>; rel="next"' };
  const { fetch, calls } = fakeFetch([{ body: [{ number: 1 }], headers: next }, { body: [{ number: 2 }] }]);
  const all = await gh("t", { fetch }).paginate("GET /repos/{owner}/{repo}/issues", { owner: "o", repo: "r" });
  assert.deepEqual(all.map((issue) => issue.number), [1, 2]);
  assert.equal(calls.length, 2);
});

test("gh: a secondary rate limit is retried once, then fails", async () => {
  const ok = fakeFetch([secondaryLimit("1"), { body: { login: "ada" } }]);
  assert.equal((await gh("t1", { fetch: ok.fetch }).request("GET /user")).data.login, "ada");
  assert.equal(ok.calls.length, 2);

  const twice = fakeFetch([secondaryLimit("1"), secondaryLimit("1")]);
  await assert.rejects(gh("t2", { fetch: twice.fetch }).request("GET /user"), /secondary rate limit/);
  assert.equal(twice.calls.length, 2);
});

test("gh: a rate limit too long to wait out fails at once", async () => {
  const { fetch, calls } = fakeFetch([secondaryLimit("3600")]);
  await assert.rejects(gh("t3", { fetch }).request("GET /user"), /secondary rate limit/);
  assert.equal(calls.length, 1);
});

const ISSUES = "query($owner: String!, $cursor: String) { repository(owner: $owner) { issues(first: 1, after: $cursor) { nodes { number } pageInfo { hasNextPage endCursor } } } }";
const page = (numbers: number[], endCursor: string | null) => ({ body: { data: { repository: { issues: { nodes: numbers.map((number) => ({ number })), pageInfo: { hasNextPage: endCursor !== null, endCursor } } } } } });

test("graphqlPaginate: follows the cursor until the last page", async () => {
  const { fetch, calls } = fakeFetch([page([1], "c1"), page([2], null)]);
  const nodes = await graphqlPaginate<{ number: number }>(gh("t4", { fetch }), ISSUES, { owner: "o" }, ["repository", "issues"]);
  assert.deepEqual(nodes, [{ number: 1 }, { number: 2 }]);
  assert.deepEqual(calls.map((call) => (call.body as { variables: { cursor: unknown } }).variables.cursor), [null, "c1"]);
});

test("graphqlPaginate: stops at maxPages", async () => {
  const { fetch, calls } = fakeFetch([page([1], "c1"), page([2], "c2")]);
  const nodes = await graphqlPaginate<{ number: number }>(gh("t5", { fetch }), ISSUES, { owner: "o" }, ["repository", "issues"], 1);
  assert.deepEqual(nodes, [{ number: 1 }]);
  assert.equal(calls.length, 1);
});

test("graphqlPaginate: rejects a wrong path, an empty path and a bad page cap", async () => {
  const { fetch } = fakeFetch([page([1], null)]);
  await assert.rejects(graphqlPaginate(gh("t6", { fetch }), ISSUES, { owner: "o" }, ["repository", "pullRequests"]), /no connection at repository.pullRequests/);
  await assert.rejects(graphqlPaginate(gh("t6"), ISSUES, {}, []), /needs the connection's path/);
  for (const bad of [0, -1, 1.5]) await assert.rejects(graphqlPaginate(gh("t6"), ISSUES, {}, ["a"], bad), /positive integer/);
});
