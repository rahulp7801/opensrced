// lib/harness-issue.ts: an issue and its newest comments for read_issue, against a fake GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_TEXT_MAX, IssueThreadError, readIssueThread } from "../harness-issue";

function github(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    const body = routes[url.pathname];
    return body === undefined
      ? new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fake, seen };
}

test("an issue with its newest comments, maintainers marked, long text clipped", async () => {
  const { fake, seen } = github({
    "/repos/pallets/itsdangerous/issues/429": { title: "loads ignores max_age", body: "Repro: ...", state: "open", html_url: "https://github.com/pallets/itsdangerous/issues/429", comments: 2 },
    "/repos/pallets/itsdangerous/issues/429/comments": [
      { user: { login: "davidism" }, author_association: "MEMBER", created_at: "2026-10-01T10:00:00Z", body: "Agreed, PR welcome." },
      { user: null, author_association: "NONE", created_at: "2026-10-02T10:00:00Z", body: "x".repeat(COMMENT_TEXT_MAX + 50) },
    ],
  });
  const t = await readIssueThread("pallets/itsdangerous", 429, "ghp_test", fake);
  assert.deepEqual([t.repo, t.number, t.title, t.state, t.more_comments], ["pallets/itsdangerous", 429, "loads ignores max_age", "open", 0]);
  assert.deepEqual(t.comments.map((c) => [c.author, c.association, c.at]), [["davidism", "MEMBER", "2026-10-01"], ["ghost", "NONE", "2026-10-02"]]);
  assert.match(t.comments[1]!.body, /… \[cut\]$/);
  assert.ok(seen.some((s) => s.includes("/comments?") && s.includes("per_page=20") && s.includes("page=1")));
});

test("with more comments than it shows, it reads the newest page and says how many are older", async () => {
  const { fake, seen } = github({
    "/repos/a/b/issues/7": { title: "t", body: "", state: "closed", comments: 45 },
    "/repos/a/b/issues/7/comments": Array.from({ length: 5 }, (_, i) => ({ user: { login: `u${i}` }, author_association: "NONE", created_at: "2026-01-01", body: "c" })),
  });
  const t = await readIssueThread("a/b", "7", "ghp_test", fake);
  assert.ok(seen.some((s) => s.includes("page=3")), "45 comments at 20 a page: the newest are on page 3");
  assert.deepEqual([t.comments.length, t.more_comments], [5, 40]);
});

for (const [what, repo, issue, token, status, message] of [
  ["a malformed repo", "not a repo", 1, "t", 422, /owner\/name/],
  ["a zero issue", "a/b", 0, "t", 422, /issue's number/],
  ["text for a number", "a/b", "x", "t", 422, /issue's number/],
  ["no server token", "a/b", 1, "", 503, /gh auth login/],
] as const) {
  test(`${what} is refused before GitHub is asked`, async () => {
    const { fake, seen } = github({});
    await assert.rejects(readIssueThread(repo, issue, token, fake), (e: unknown) => e instanceof IssueThreadError && e.status === status && message.test(e.message));
    assert.equal(seen.length, 0);
  });
}

test("an unknown issue and a pull request say so", async () => {
  const { fake } = github({ "/repos/a/b/issues/2": { title: "a PR", pull_request: {}, comments: 0 } });
  await assert.rejects(readIssueThread("a/b", 1, "t", fake), (e: unknown) => e instanceof IssueThreadError && e.status === 404 && /no issue #1/.test(e.message));
  await assert.rejects(readIssueThread("a/b", 2, "t", fake), (e: unknown) => e instanceof IssueThreadError && e.status === 422 && /pull request/.test(e.message));
});
