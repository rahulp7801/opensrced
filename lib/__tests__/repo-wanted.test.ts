import { test } from "node:test";
import assert from "node:assert/strict";
import type { GitHubClient } from "../gh";
import { InvalidRepoNameError } from "../ai-policy";
import { MIN_SAMPLE, RepoNotFoundError } from "../repo-profile";
import {
  closedQuery, fetchWanted, isInviteLabel, MAX_LABELS, RepoWantedFetchError, summarizeWanted, wantedFindings, WANTED_SAMPLE,
  type WantedInput, type WantedIssue, type WantedLabelNode, type WantedPr,
} from "../repo-wanted";

const NOW = new Date("2026-11-05T12:00:00Z");
const MAINT = { login: "maint" };

const LABELS: Array<[string, boolean]> = [
  ["help wanted", true], ["Help Wanted", true], ["help-wanted", true], ["status: help wanted", true], ["🙋 help wanted", true],
  ["good first issue", true], ["Good First Issue", true], ["good-first-issue", true], ["good second issue", true],
  ["first-timers-only", true], ["contributions welcome", true], ["PR welcome", true], ["PRs welcome", true],
  ["status: accepted", true], ["accepted", true], ["easy", true], ["difficulty: easy", true], ["Easy Fix", true],
  ["beginner-friendly", true], ["up-for-grabs", true],
  ["hacktoberfest-accepted", false], ["hacktoberfest", false], ["bug", false], ["Needs Tests", false],
  ["feedback wanted", false], ["easy-to-reproduce", false], ["not accepted", false], ["", false],
];
for (const [name, invites] of LABELS) {
  test(`label "${name}" ${invites ? "invites" : "does not invite"} contributions`, () => {
    assert.equal(isInviteLabel(name), invites);
  });
}

let n = 0;
const prBy = (login: string, o: Partial<WantedPr> = {}): WantedPr =>
  ({ url: `https://github.com/acme/app/pull/${++n}`, merged: true, author: { login }, authorAssociation: "CONTRIBUTOR", mergedBy: MAINT, ...o });
/** A closed invited issue; `closer` is the PR named by the ClosedEvent, `refs` the PRs that say they close it. */
function issue(o: { closer?: WantedPr | { __typename: "Commit" } | null; refs?: WantedPr[]; actor?: string; author?: string } = {}): WantedIssue {
  const closer = o.closer === undefined ? null : o.closer && "url" in o.closer ? { __typename: "PullRequest", ...o.closer } : o.closer;
  return {
    url: `https://github.com/acme/app/issues/${++n}`,
    author: { login: o.author ?? `reporter${n}` },
    closedByPullRequestsReferences: { nodes: o.refs ?? [] },
    timelineItems: { nodes: [{ actor: { login: o.actor ?? "maint" }, closer }] },
  };
}
const label = (name: string, open: number): WantedLabelNode =>
  ({ name, issues: { totalCount: open, nodes: Array.from({ length: Math.min(open, 3) }, (_, i) => ({ url: `https://github.com/acme/app/issues/${name.length}${i}` })) } });
const input = (o: Partial<WantedInput> = {}): WantedInput => ({ openIssues: 50, labels: [label("good first issue", 7)], closed: [], pinned: [], ...o });

test("closed invited issues are sorted by who fixed them: outsiders, the team, or no merged PR", () => {
  const closed = [
    ...Array.from({ length: 4 }, () => issue({ closer: prBy("newcomer") })),
    issue({ refs: [prBy("closed-by-hand-after-merge")] }), // closed by hand after a merged PR said "fixes"
    issue({ closer: prBy("maint") }), // a maintainer's own PR
    issue({ closer: prBy("member", { authorAssociation: "MEMBER" }) }),
    issue({ closer: prBy("renovate[bot]", { author: { login: "renovate[bot]", __typename: "Bot" } }) }),
    issue({ closer: prBy("open-pr", { merged: false }) }), // linked PR never merged
    issue({ closer: { __typename: "Commit" } }), // a maintainer's commit
    issue({ actor: "reporter-self" }), // closed by hand, no PR
  ];
  const w = summarizeWanted("acme/app", input({ closed }), NOW);
  assert.deepEqual([w.closed.outside.count, w.closed.team.count, w.closed.unmerged.count, w.closed.outside.of], [5, 3, 3, 11]);
  assert.equal(w.closed.outside.examples.length, 3);
  assert.ok(w.closed.outside.examples.every((u) => u.includes("/pull/")), "examples are the outside PRs");
  assert.deepEqual([w.closed.from, w.closed.to], ["2026-07-08", "2026-10-06"]);
  assert.ok(!JSON.stringify(w).includes("newcomer") && !JSON.stringify(w).includes("maint\""), "no logins in the signal");
});

test("someone who merged a PR is a maintainer even when GitHub calls them CONTRIBUTOR", () => {
  const closed = [issue({ closer: prBy("newcomer", { mergedBy: { login: "alex" } }) }), issue({ closer: prBy("alex") })];
  const w = summarizeWanted("acme/app", input({ closed }), NOW);
  assert.deepEqual([w.closed.outside.count, w.closed.team.count], [1, 1]);
});

test("findings: labels in use, whether invitations pay off, and pinned issues", () => {
  const closed = [...Array.from({ length: 3 }, () => issue({ closer: prBy("newcomer") })), issue({ closer: prBy("maint") }), issue()];
  const w = summarizeWanted("acme/app", input({
    labels: [label("help wanted", 2), label("good first issue", 7), label("easy", 0)],
    closed,
    pinned: [{ title: "Roadmap 2027", url: "https://github.com/acme/app/issues/1" }],
  }), NOW);
  assert.deepEqual(w.labels.map((l) => [l.name, l.count, l.of]), [["good first issue", 7, 50], ["help wanted", 2, 50], ["easy", 0, 50]]);
  const findings = wantedFindings(w);
  assert.deepEqual(findings.map((f) => f.text), [
    '7 of 50 open issues are labelled "good first issue".',
    '2 of 50 open issues are labelled "help wanted".',
    'Of 5 issues labelled "good first issue", "help wanted" or "easy" that were closed 1–4 months ago, 3 (60%) were fixed by an outside contributor\'s merged PR, 1 by a maintainer\'s own PR, and 1 closed without a merged PR.',
    'Pinned by the maintainers: "Roadmap 2027".',
  ]);
  assert.deepEqual(findings.map((f) => f.examples.length), [3, 2, 3, 1]);
});

const QUIET: Array<[string, WantedInput, string[]]> = [
  ["no invitation labels", input({ labels: [] }), ['None of the project\'s issue labels is a usual invitation to contribute ("help wanted", "good first issue" or similar).']],
  ["one open issue", input({ labels: [label("help wanted", 1)] }), ['1 of 50 open issues is labelled "help wanted".']],
  ["one label, no open issue", input({ labels: [label("help wanted", 0)] }), ['The project has the label "help wanted", but no open issue carries it now.']],
  ["two labels, no open issue", input({ labels: [label("help wanted", 0), label("easy", 0)] }), ['The project has the labels "help wanted" and "easy", but no open issue carries them now.']],
  ["zero open issues at all", input({ openIssues: 0, labels: [label("easy", 0)] }), ['The project has the label "easy", but no open issue carries it now.']],
  [`${MIN_SAMPLE - 1} closed invited issues: too few to say`, input({ closed: Array.from({ length: MIN_SAMPLE - 1 }, () => issue({ closer: prBy("x") })) }),
    ['7 of 50 open issues are labelled "good first issue".']],
];
for (const [name, given, expected] of QUIET) {
  test(`findings: ${name}`, () => {
    assert.deepEqual(wantedFindings(summarizeWanted("acme/app", given, NOW)).map((f) => f.text), expected);
  });
}

test("the closed-issue search ORs the labels over the profile's 30–120 day window", () => {
  assert.equal(closedQuery("Acme/App", ["help wanted", "good first issue", 'bad "quote"'], NOW),
    'repo:Acme/App is:issue is:closed label:"help wanted","good first issue" closed:2026-07-08..2026-10-06 sort:created-desc');
});

type Fake = { labels?: string[][]; counts?: Record<string, number>; closed?: WantedIssue[][]; repository?: null; error?: Error; nameWithOwner?: string };
/** A fake client answering the three queries by name. `calls` holds [query name, variables]. */
function fake(o: Fake = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const pages = o.labels ?? [["bug", "help wanted"]];
  const client = {
    async graphql(query: string, variables: Record<string, unknown>) {
      if (o.error) throw o.error;
      const op = /query (\w+)/.exec(query)![1];
      calls.push([op, variables]);
      if (op === "RepoWantedLabels") {
        if (o.repository === null) return { repository: null };
        const i = calls.filter(([c]) => c === op).length - 1;
        return { repository: {
          nameWithOwner: o.nameWithOwner ?? "Acme/App", issues: { totalCount: 40 },
          pinnedIssues: { nodes: [{ issue: { title: "Where we need help", url: "https://github.com/acme/app/issues/9" } }, { issue: null }] },
          labels: { pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: `c${i}` }, nodes: pages[i].map((name) => ({ name })) },
        } };
      }
      if (op === "RepoWantedCounts") {
        const repository: Record<string, WantedLabelNode> = {};
        for (const [key, value] of Object.entries(variables)) if (/^l\d+$/.test(key)) repository[key] = label(String(value), o.counts?.[String(value)] ?? 1);
        return { repository };
      }
      const i = calls.filter(([c]) => c === op).length - 1;
      const all = o.closed ?? [];
      return { search: { issueCount: all.flat().length, nodes: [...(all[i] ?? []), {}], pageInfo: { hasNextPage: i + 1 < all.length, endCursor: `s${i}` } } };
    },
  } as unknown as GitHubClient;
  return { calls, client };
}

test("fetching reads every label page, counts the invitation labels, and searches under GitHub's name", async () => {
  const f = fake({
    labels: [["bug", "help wanted"], ["good first issue", "hacktoberfest-accepted"]],
    counts: { "help wanted": 4, "good first issue": 2 },
    closed: [Array.from({ length: 3 }, () => issue({ closer: prBy("newcomer") })), [issue()]],
  });
  const w = await fetchWanted(f.client, "acme", "app", NOW);
  assert.equal(w.repo, "Acme/App");
  assert.equal(w.openIssues, 40);
  assert.deepEqual(w.labels.map((l) => [l.name, l.count]), [["help wanted", 4], ["good first issue", 2]]);
  assert.deepEqual([w.closed.outside.count, w.closed.unmerged.count, w.closed.outside.of, w.closed.total], [3, 1, 4, 4], "both search pages, non-issue hits dropped");
  assert.deepEqual(w.pinned, [{ title: "Where we need help", url: "https://github.com/acme/app/issues/9" }]);
  assert.deepEqual(f.calls.map(([op]) => op), ["RepoWantedLabels", "RepoWantedLabels", "RepoWantedCounts", "RepoWantedClosed", "RepoWantedClosed"]);
  assert.deepEqual([f.calls[1][1].owner, f.calls[1][1].cursor], ["Acme", "c0"]);
  assert.match(String(f.calls[3][1].q), /^repo:Acme\/App is:issue is:closed label:"help wanted","good first issue" /);
});

test("a repository with no invitation labels costs one request and says so", async () => {
  const f = fake({ labels: [["bug", "docs"]] });
  const w = await fetchWanted(f.client, "acme", "app", NOW);
  assert.equal(f.calls.length, 1);
  assert.deepEqual([w.labels, w.closed.outside.of], [[], 0]);
  assert.match(wantedFindings(w)[0].text, /^None of the project's issue labels/);
});

test("at most MAX_LABELS labels are looked up, and at most WANTED_SAMPLE closed issues read", async () => {
  const many = Array.from({ length: MAX_LABELS + 3 }, (_, i) => `help wanted ${i}`);
  const f = fake({ labels: [many], closed: Array.from({ length: 4 }, () => Array.from({ length: 50 }, () => issue())) });
  const w = await fetchWanted(f.client, "acme", "app", NOW);
  assert.equal(w.labels.length, MAX_LABELS);
  assert.deepEqual([w.closed.unmerged.of, w.closed.total], [WANTED_SAMPLE, 200]);
  assert.match(wantedFindings(w).at(-2)!.text, /closed 1–4 months ago \(the 100 most recently opened of 200\), 0 \(0%\)/);
  assert.equal(f.calls.filter(([op]) => op === "RepoWantedClosed").length, WANTED_SAMPLE / 50);
});

const FAILURES: Array<[string, () => Promise<unknown>, new (...args: never[]) => Error]> = [
  ["an unknown repository", () => fetchWanted(fake({ repository: null }).client, "acme", "gone", NOW), RepoNotFoundError],
  ["a GitHub error", () => fetchWanted(fake({ error: new Error("rate limited") }).client, "acme", "app", NOW), RepoWantedFetchError],
  ["a malformed name", () => fetchWanted(fake().client, "acme", "a/b", NOW), InvalidRepoNameError],
  ["an empty name", () => fetchWanted(fake().client, "", "app", NOW), InvalidRepoNameError],
];
for (const [name, run, error] of FAILURES) {
  test(`fetching: ${name} is a named error, never an empty result`, async () => {
    await assert.rejects(run(), error);
  });
}

test("a failure after the first request is a named error too, with GitHub's error as the cause", async () => {
  let calls = 0;
  const flaky = {
    async graphql(query: string) {
      if (++calls > 1) throw new Error("secondary rate limit");
      return fake().client.graphql(query, { owner: "acme", name: "app", cursor: null });
    },
  } as unknown as GitHubClient;
  const error = await fetchWanted(flaky, "acme", "app", NOW).catch((e: unknown) => e);
  assert.ok(error instanceof RepoWantedFetchError);
  assert.equal((error.cause as Error).message, "secondary rate limit");
});
