// "How <repo> likes PRs": fixtures shaped like GitHub's GraphQL answer (no
// live fetches), the summary rules, the card lines, and the cache.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { gh } from "../gh";
import { InvalidRepoNameError } from "../ai-policy";
import {
  changelogLocation, clearMaintainerPrefsCache, fetchMaintainerPrefs, isBotAuthor, maintainerPrefs, MaintainerPrefsFetchError, prefsLines,
  PREFS_SAMPLE, PREFS_TTL_MS, summarizePrefs, titleConvention, type MergedPrNode,
} from "../maintainer-prefs";

const T0 = "2026-10-01T00:00:00Z";
const hoursAfter = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();

function pr(over: Partial<MergedPrNode> & { paths?: string[]; signed?: boolean; reviewAfter?: number | null } = {}): MergedPrNode {
  const { paths = ["src/app.py"], signed = false, reviewAfter = 5, ...rest } = over;
  return {
    title: "fix: keep the session on redirect", additions: 10, deletions: 2, changedFiles: paths.length, createdAt: T0,
    author: { login: "alice", __typename: "User" },
    files: { nodes: paths.map((path) => ({ path })) },
    commits: { nodes: [{ commit: { message: signed ? "Fix it\n\nSigned-off-by: Alice <a@example.com>" : "Fix it" } }] },
    reviews: { nodes: reviewAfter === null ? [] : [{ createdAt: hoursAfter(reviewAfter), authorAssociation: "MEMBER", author: { login: "maint", __typename: "User" } }] },
    comments: { nodes: [] },
    ...rest,
  };
}

test("changelogLocation: root and docs changelogs and fragment directories; not code that happens to be called news", () => {
  const cases: Array<[string, string | null]> = [
    ["CHANGELOG.md", "CHANGELOG.md"], ["docs/changelog.rst", "docs/changelog.rst"], ["HISTORY.md", "HISTORY.md"],
    ["changes/1234.bugfix.md", "changes/"], ["newsfragments/99.feature", "newsfragments/"], [".changeset/blue-cats.md", ".changeset/"],
    ["Misc/NEWS.d/next/Library/2026-10-01.gh-1.rst", "Misc/NEWS.d/"], ["docs/changes/1.md", "docs/changes/"],
    ["src/news/models.py", null], ["src/history.py", null], ["app/changelog_view.py", null], ["README.md", null], ["", null],
  ];
  for (const [path, want] of cases) assert.equal(changelogLocation(path), want, path);
});

test("titleConvention: the style most titles share, or none below the norm", () => {
  assert.equal(titleConvention(["fix: a", "feat(api): b", "docs: c", "Bump x"]), "conventional");
  assert.equal(titleConvention(["gh-123: a", "asyncio: b", "typing: c"]), "prefix");
  assert.equal(titleConvention(["[docs] a", "[core] b", "Fix c"]), "bracket");
  assert.equal(titleConvention(["Fix a", "Add b", "fix: c"]), "none");
  assert.equal(titleConvention([]), "none");
});

const BOTS: Array<[{ login: string; __typename?: string } | null, boolean]> = [
  [{ login: "dependabot[bot]", __typename: "Bot" }, true],
  [{ login: "pre-commit-ci[bot]" }, true],
  [{ login: "pyup-bot", __typename: "User" }, true], // earthpy: a bot on a user account
  [{ login: "deploy_bot", __typename: "User" }, true],
  [{ login: "renovate", __typename: "User" }, true],
  [null, true], // a deleted account
  [{ login: "abbott", __typename: "User" }, false],
  [{ login: "talbot", __typename: "User" }, false],
  [{ login: "botanist", __typename: "User" }, false],
  [{ login: "bot-fan", __typename: "User" }, false],
];
for (const [author, expected] of BOTS) {
  test(`isBotAuthor(${author?.login ?? "null"}) → ${expected}`, () => assert.equal(isBotAuthor(author), expected));
}

test("summarizePrefs: medians, shares, the commonest changelog location; bots are left out", () => {
  const prs = [
    pr({ paths: ["src/a.py", "tests/test_a.py", "changes/1.bugfix.md"], signed: true, reviewAfter: 2 }),
    pr({ paths: ["src/b.py", "changes/2.feature.md"], signed: true, reviewAfter: 10, additions: 100, deletions: 20 }),
    pr({ paths: ["src/c_test.go", "CHANGELOG.md"], signed: true, reviewAfter: null }),
    pr({ paths: ["docs/index.md"], title: "Update docs", signed: false, reviewAfter: 30 }),
    // Bots: neither counted nor their reviews.
    pr({ author: { login: "dependabot", __typename: "Bot" }, paths: ["requirements.txt"] }),
    pr({ author: { login: "pre-commit-ci[bot]", __typename: "Bot" }, paths: [".pre-commit-config.yaml"] }),
  ];
  const p = summarizePrefs("pallets/flask", prs, true);
  assert.equal(p.sample, 4);
  assert.equal(p.medianFiles, 2);
  assert.equal(p.medianLines, 12);
  assert.equal(p.testsShare, 0.5);
  assert.equal(p.changelogShare, 0.75);
  assert.equal(p.changelogPath, "changes/");
  assert.equal(p.titleConvention, "conventional");
  assert.equal(p.signOffShare, 0.75);
  assert.equal(p.prTemplate, true);
  assert.equal(p.medianFirstReviewHours, 10, "the PR without a review is left out");
});

test("summarizePrefs: the author's own and bots' reviews are not a first review", () => {
  const own = pr({ reviewAfter: null, reviews: { nodes: [
    { createdAt: hoursAfter(1), authorAssociation: "MEMBER", author: { login: "alice", __typename: "User" } },
    { createdAt: hoursAfter(2), authorAssociation: "NONE", author: { login: "codecov", __typename: "Bot" } },
    { createdAt: hoursAfter(50), authorAssociation: "OWNER", author: { login: "maint", __typename: "User" } },
  ] } });
  assert.equal(summarizePrefs("o/r", [own], false).medianFirstReviewHours, 50);
});

test("summarizePrefs and prefsLines: nothing to learn from says so, never invents", () => {
  const empty = summarizePrefs("o/r", [pr({ author: { login: "renovate", __typename: "Bot" } })], false);
  assert.deepEqual([empty.sample, empty.medianFiles, empty.testsShare, empty.changelogPath, empty.titleConvention], [0, null, null, null, "none"]);
  assert.deepEqual(prefsLines(empty), []);
});

test("prefsLines: plain sentences, only for what was measured", () => {
  const lines = prefsLines(summarizePrefs("o/r", [pr({ paths: ["src/a.py", "tests/test_a.py", "CHANGELOG.md"], signed: true }), pr({ paths: ["src/b.py"], signed: true })], false));
  assert.deepEqual(lines, [
    "A typical merged PR changes 2 files and 12 lines (median of 2).",
    "50% of them touch tests.",
    "50% add a changelog entry (in CHANGELOG.md).",
    'Titles follow Conventional Commits ("fix: …", "feat(scope): …").',
    'Commits are signed off (git commit -s, "Signed-off-by:"); 100% of PRs do.',
    "There is no pull request template.",
    "A maintainer usually first responds within about 5 hours.",
  ]);
  const quiet = prefsLines(summarizePrefs("o/r", [pr({ title: "Fix", reviewAfter: null })], true));
  assert.ok(quiet.includes("The repository has a pull request template: fill it in."));
  assert.ok(!quiet.some((l) => /changelog|signed off|Titles|responds/.test(l)), "no changelog, sign-off, convention or review line when unmeasured");
});

/** GitHub GraphQL answering with the given PRs, counting calls. */
function fakeGitHub(answer: { prs: MergedPrNode[]; templates?: number } | "missing" | "error") {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(request);
    if (answer === "error") return new Response("{\"message\":\"Bad credentials\"}", { status: 401, headers: { "content-type": "application/json" } });
    const repository = answer === "missing" ? null
      : { pullRequestTemplates: Array.from({ length: answer.templates ?? 0 }, () => ({ filename: "PULL_REQUEST_TEMPLATE.md" })), pullRequests: { nodes: answer.prs } };
    return new Response(JSON.stringify({ data: { repository } }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { client: gh(`t-${Math.random()}`, { fetch }), calls };
}

beforeEach(() => clearMaintainerPrefsCache());

test("fetchMaintainerPrefs: one GraphQL call for the recent merged PRs and the template", async () => {
  const github = fakeGitHub({ prs: [pr(), pr()], templates: 1 });
  const p = await fetchMaintainerPrefs(github.client, "pallets/flask");
  assert.equal(github.calls.length, 1);
  assert.deepEqual(github.calls[0].variables, { owner: "pallets", name: "flask", n: PREFS_SAMPLE });
  assert.match(github.calls[0].query, /pullRequests\(states: MERGED/);
  assert.deepEqual([p.repo, p.sample, p.prTemplate], ["pallets/flask", 2, true]);
});

test("fetchMaintainerPrefs: failures are named errors; a bad name never reaches GitHub", async () => {
  await assert.rejects(fetchMaintainerPrefs(fakeGitHub("missing").client, "a/b"), MaintainerPrefsFetchError);
  await assert.rejects(fetchMaintainerPrefs(fakeGitHub("error").client, "a/b"), MaintainerPrefsFetchError);
  for (const bad of ["", "a", "a/b/c", "../x"]) {
    const github = fakeGitHub({ prs: [] });
    await assert.rejects(fetchMaintainerPrefs(github.client, bad), InvalidRepoNameError, bad);
    assert.equal(github.calls.length, 0, bad);
  }
});

test("maintainerPrefs: cached per repository (case-insensitive) until the TTL passes; failures are not cached", async () => {
  const github = fakeGitHub({ prs: [pr()] });
  const now = 1_800_000_000_000;
  await maintainerPrefs(github.client, "pallets/flask", now);
  await maintainerPrefs(github.client, "Pallets/Flask", now + PREFS_TTL_MS - 1);
  assert.equal(github.calls.length, 1);
  await maintainerPrefs(github.client, "pallets/flask", now + PREFS_TTL_MS);
  assert.equal(github.calls.length, 2);
  const failing = fakeGitHub("error");
  await assert.rejects(maintainerPrefs(failing.client, "x/y", now), MaintainerPrefsFetchError);
  await assert.rejects(maintainerPrefs(failing.client, "x/y", now), MaintainerPrefsFetchError);
  assert.equal(failing.calls.length, 2);
});
