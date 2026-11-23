// lib/harness-issue.ts: an issue and its newest comments for read_issue, against a fake GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_TEXT_MAX, IssueThreadError, listOpenIssues, readIssueThread } from "../harness-issue";

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
  assert.deepEqual(t.comments.map((c) => [c.author, c.association, c.maintainer, c.at]), [["davidism", "MEMBER", true, "2026-10-01"], ["ghost", "NONE", false, "2026-10-02"]]);
  assert.match(t.comments[1]!.body, /… \[cut\]$/);
  assert.ok(seen.some((s) => s.includes("/comments?") && s.includes("per_page=20") && s.includes("page=1")));
});

test("someone who merges the repository's PRs is a maintainer, whatever GitHub's association says (pypa/packaging's henryiii)", async () => {
  const issue = { "/repos/pypa/packaging/issues/934": { title: "t", body: "", state: "open", comments: 2 } };
  const comments = { "/repos/pypa/packaging/issues/934/comments": [
    { user: { login: "henryiii" }, author_association: "CONTRIBUTOR", created_at: "2026-04-27", body: "The real work is deciding which direction to go." },
    { user: { login: "jsirois" }, author_association: "CONTRIBUTOR", created_at: "2026-04-22", body: "I in no way want this feature!" },
  ] };
  const mergers = { "/graphql": { data: { repository: { pullRequests: { nodes: [{ mergedBy: { login: "henryiii" } }, { mergedBy: null }] } } } } };
  const t = await readIssueThread("pypa/packaging", 934, "t", github({ ...issue, ...comments, ...mergers }).fake);
  assert.deepEqual(t.comments.map((c) => [c.author, c.association, c.maintainer]), [["henryiii", "CONTRIBUTOR", true], ["jsirois", "CONTRIBUTOR", false]]);
  // GitHub won't say who merged: the association alone, never an error.
  const failed = await readIssueThread("pypa/packaging", 934, "t", github({ ...issue, ...comments }).fake);
  assert.deepEqual(failed.comments.map((c) => c.maintainer), [false, false]);
  // Every commenter a maintainer by association already: no lookup.
  const { fake, seen } = github({ ...issue, "/repos/pypa/packaging/issues/934/comments": [{ user: { login: "pradyunsg" }, author_association: "MEMBER", created_at: "2026-04-22", body: "x" }], ...mergers });
  assert.equal((await readIssueThread("pypa/packaging", 934, "t", fake)).comments[0]!.maintainer, true);
  assert.ok(!seen.includes("/graphql"));
});

test("listOpenIssues: the newest open issues, each taken by an assignee or an open PR naming it, or maybe fixed already", async () => {
  const issue = (number: number, title: string, createdAt: string, o: { labels?: string[]; assignees?: string[]; comments?: Array<{ body: string; login: string; assoc: string }>; body?: string } = {}) => ({
    number, title, url: `https://github.com/markedjs/marked/issues/${number}`, body: o.body ?? "", createdAt,
    labels: { nodes: (o.labels ?? []).map((name) => ({ name })) }, assignees: { nodes: (o.assignees ?? []).map((login) => ({ login })) },
    comments: { totalCount: (o.comments ?? []).length, nodes: (o.comments ?? []).map((c) => ({ body: c.body, author: { login: c.login }, authorAssociation: c.assoc, createdAt })) },
  });
  const { fake, seen } = github({
    "/graphql": { data: { repository: { hasIssuesEnabled: true, issues: { nodes: [
      issue(4273, "Quadratic links", "2026-11-22T01:00:00Z", { labels: ["perf"] }),
      issue(4253, "Lazy line", "2026-11-17T01:00:00Z", { labels: ["bug"], comments: [{ body: "a", login: "x", assoc: "NONE" }, { body: "b", login: "y", assoc: "NONE" }] }),
      issue(42, "Old", "2020-01-01T00:00:00Z", { assignees: ["uzi"] }),
      issue(4, "Free", "2019-01-01T00:00:00Z"),
      // cheerio #5368: open, but a comment says main has it.
      issue(5368, "fromURL base", "2026-07-25T00:00:00Z", { comments: [{ body: "Root cause, for the record: this is fixed on `main`, but only by accident.", login: "v", assoc: "CONTRIBUTOR" }] }),
    ] } } } },
    "/repos/markedjs/marked/pulls": [
      { number: 4274, title: "fix: avoid quadratic scan", body: "Fixes #4273" },
      { number: 4254, title: "fix: lazy lines", body: "See https://github.com/markedjs/marked/issues/4253 and #42" },
      { number: 4260, title: "also lazy (#4253)", body: null },
      { number: 9, title: "mentions #40 and #4253x", body: "" },
    ],
  });
  const list = await listOpenIssues("markedjs/marked", "t", fake);
  assert.equal(list.repo, "markedjs/marked");
  assert.deepEqual(list.issues.map((i) => [i.number, i.taken]), [[4273, "open PR #4274"], [4253, "open PR #4254, #4260"], [42, "assigned to @uzi"], [4, null], [5368, null]]);
  assert.deepEqual([list.issues[0]!.labels, list.issues[0]!.opened, list.issues[1]!.labels, list.issues[1]!.comments, list.issues[3]!.url], [["perf"], "2026-11-22", ["bug"], 2, "https://github.com/markedjs/marked/issues/4"]);
  assert.deepEqual(list.issues.map((i) => i.resolved), [null, null, null, null, 'comment by @v says "this is fixed"']);
  assert.ok(seen.some((s) => s.startsWith("/repos/markedjs/marked/pulls?") && s.includes("per_page=100")));
});

test("listOpenIssues: a bad repo is refused before GitHub; a missing one says so", async () => {
  const { fake, seen } = github({});
  await assert.rejects(listOpenIssues("nope", "t", fake), (e: unknown) => e instanceof IssueThreadError && e.status === 422);
  await assert.rejects(listOpenIssues("a/b", "", fake), (e: unknown) => e instanceof IssueThreadError && e.status === 503);
  assert.equal(seen.length, 0);
  await assert.rejects(listOpenIssues("a/b", "t", fake), (e: unknown) => e instanceof IssueThreadError && e.status === 404 && /wasn't found/.test(e.message));
  // GitHub's GraphQL answers a missing repository with NOT_FOUND errors; issues turned off says so too.
  const notFound = github({ "/graphql": { data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] } }).fake;
  await assert.rejects(listOpenIssues("a/b", "t", notFound), (e: unknown) => e instanceof IssueThreadError && e.status === 404);
  const off = github({ "/graphql": { data: { repository: { hasIssuesEnabled: false, issues: { nodes: [] } } } } }).fake;
  await assert.rejects(listOpenIssues("a/b", "t", off), (e: unknown) => e instanceof IssueThreadError && e.status === 404);
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

test("open pull requests in the repo that name the issue come back, newest first; one that only has the number, or isn't a PR, doesn't; an unreadable search says so", async () => {
  const pr = (number: number, body: string, login = "dev") => ({ number, title: `PR ${number}`, body, html_url: `https://github.com/sindresorhus/p-queue/pull/${number}`, user: { login }, pull_request: {} });
  const { fake, seen } = github({
    "/repos/sindresorhus/p-queue/issues/177": { title: "t", body: "", state: "open", comments: 0 },
    "/search/issues": { items: [
      pr(233, "Fixes #177.", "Richienb"), pr(230, "Bumps x from 1.177 to 1.178"), pr(229, "Part of #1770"),
      pr(224, "See https://github.com/sindresorhus/p-queue/issues/177", "Richienb"), { number: 9, title: "issue #177", body: "" },
    ] },
    "/repos/sindresorhus/p-queue/pulls": [pr(240, "Handles the timeout case", "quiet"), pr(233, "Fixes #177.", "Richienb")],
  });
  const t = await readIssueThread("sindresorhus/p-queue", 177, "ghp_test", fake);
  assert.deepEqual(t.open_prs?.map((p) => [p.number, p.author]), [[233, "Richienb"], [224, "Richienb"]]);
  assert.deepEqual(t.other_prs?.map((p) => [p.number, p.author]), [[240, "quiet"]], "the other open PRs, less those already listed: one may fix it without naming it");
  assert.ok(seen.some((s) => s.startsWith("/repos/sindresorhus/p-queue/pulls?") && s.includes("state=open") && s.includes("per_page=30")));
  const q = new URL(`https://x${seen.find((s) => s.startsWith("/search/issues"))}`).searchParams.get("q");
  assert.equal(q, "repo:sindresorhus/p-queue is:pr is:open 177", "only this repo's open PRs: a fork's can't be merged here");
  const { fake: noSearch } = github({ "/repos/a/b/issues/7": { title: "t", body: "", state: "open", comments: 0 } });
  const unread = await readIssueThread("a/b", 7, "ghp_test", noSearch);
  assert.deepEqual([unread.open_prs, unread.other_prs], [null, null], "couldn't check: null, not an empty list");
});
