import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import type { GitHubClient } from "../gh";
import {
  closeReason, cohortQueries, COHORT_SLICES, engagementAdvice, fetchRepoProfile, maintainersOf, MIN_SAMPLE, profileFindings, repoProfile,
  RepoNotFoundError, RepoProfileFetchError, storedProfile, summarizeProfile, type CloseReason, type ProfilePr,
} from "../repo-profile";

const MAINT = { login: "maint" };
const say = (body: string, author: { login: string; __typename?: string } = MAINT, authorAssociation = "CONTRIBUTOR") =>
  ({ createdAt: "2026-10-02T00:00:00Z", body, authorAssociation, author });

let n = 0;
type Opts = Partial<ProfilePr> & { maintainerSays?: string[]; reviewSays?: string[]; tests?: boolean; issue?: boolean; login?: string };
/** A PR from an outside contributor, merged by "maint" unless `state` says otherwise. */
function pr(o: Opts = {}): ProfilePr {
  n++;
  const login = o.login ?? `contributor${n}`;
  const state = o.state ?? "MERGED";
  return {
    number: n, url: `https://github.com/acme/app/pull/${n}`, title: `fix: thing ${n}`, state,
    mergedBy: state === "MERGED" ? MAINT : null,
    createdAt: "2026-10-01T00:00:00Z", closedAt: state === "OPEN" ? null : "2026-10-03T00:00:00Z", mergedAt: state === "MERGED" ? "2026-10-03T00:00:00Z" : null,
    additions: 20, deletions: 5, changedFiles: 2, authorAssociation: "CONTRIBUTOR", author: { login },
    labels: { nodes: [] }, closingIssuesReferences: { totalCount: o.issue ? 1 : 0 },
    files: { nodes: [{ path: "src/a.py" }, ...(o.tests ? [{ path: "tests/test_a.py" }] : [])] },
    commits: { nodes: [{ commit: { message: "fix" } }] },
    reviews: { nodes: (o.reviewSays ?? []).map((body) => ({ ...say(body), comments: { nodes: [] } })) },
    comments: { nodes: (o.maintainerSays ?? []).map((body) => say(body)) },
    // Closed PRs are closed by the maintainer unless a test says otherwise.
    timelineItems: { nodes: state === "CLOSED" ? [{ actor: MAINT }] : [] },
    ...o,
  };
}
const closedPr = (o: Opts = {}) => pr({ state: "CLOSED", ...o });
const TEAM = new Set(["maint"]);
const BOT = { login: "github-actions", __typename: "Bot" };

const REASONS: Array<[string, Opts, CloseReason]> = [
  ["not assigned (pydantic's bot)", { comments: { nodes: [say("@x You do not have permission to open a PR without being assigned to the issue.", BOT)] } }, "not_assigned"],
  ["bypassing assignment", { maintainerSays: ["Please don't bypass issue assignment."] }, "not_assigned"],
  ["a duplicate", { maintainerSays: ["Thanks! This is a duplicate of #12."] }, "duplicate"],
  ["superseded", { maintainerSays: ["Closing in favour of #40."] }, "duplicate"],
  ["discuss first", { maintainerSays: ["Please open an issue first so we can discuss the design."] }, "discuss_first"],
  ["out of scope", { maintainerSays: ["This is out of scope for the project."] }, "out_of_scope"],
  ["stale bot", { comments: { nodes: [say("This PR is stale because it has had no activity.", BOT)] } }, "stale"],
  ["AI-generated", { maintainerSays: ["This looks AI-generated; we don't accept these."] }, "ai_generated"],
  ["failing CI", { maintainerSays: ["Tests are failing, closing for now."] }, "failing_checks"],
  ["a wontfix label", { labels: { nodes: [{ name: "wontfix" }] } }, "out_of_scope"],
  ["the author closing it", { login: "self", timelineItems: { nodes: [{ actor: { login: "self" } }] } }, "author_withdrew"],
  ["nothing said", {}, "unexplained"],
];
for (const [name, overrides, expected] of REASONS) {
  test(`close reason: ${name} → ${expected}`, () => {
    assert.equal(closeReason(closedPr(overrides), TEAM), expected);
  });
}

test("close reason: only maintainers' and bots' words count, not the contributor's or a passer-by's", () => {
  const own = closedPr({ login: "me", comments: { nodes: [say("duplicate of #3, sorry", { login: "me" })] } });
  assert.equal(closeReason(own, TEAM), "unexplained");
  const passerBy = closedPr({ comments: { nodes: [say("this is out of scope imo", { login: "someone" })] } });
  assert.equal(closeReason(passerBy, TEAM), "unexplained");
});

test("maintainers are who merged or closed others' PRs, even when GitHub calls them CONTRIBUTOR", () => {
  const team = maintainersOf([
    pr({ mergedBy: { login: "alex" } }), // alex merges: a maintainer with private membership
    closedPr({ timelineItems: { nodes: [{ actor: { login: "triager" } }] } }),
    closedPr({ login: "self", timelineItems: { nodes: [{ actor: { login: "self" } }] } }), // closing your own PR is not maintaining
    pr({ authorAssociation: "MEMBER", login: "member" }),
    pr({ mergedBy: { login: "merge-bot[bot]", __typename: "Bot" } }),
  ]);
  assert.deepEqual([...team].sort(), ["alex", "maint", "member", "triager"]);
});

test("the profile compares outside contributors' merged, closed and still-open PRs, leaving out bots and maintainers", () => {
  const prs = [
    ...Array.from({ length: 6 }, () => pr({ tests: true, issue: true, reviewSays: ["Please add a changelog entry."] })),
    ...Array.from({ length: 5 }, () => closedPr({ additions: 300, maintainerSays: ["Please open an issue first."] })),
    pr({ state: "OPEN" }),
    pr({ login: "maint" }), // a maintainer's own PR
    pr({ author: { login: "dependabot[bot]", __typename: "Bot" } }),
  ];
  const p = summarizeProfile("acme/app", prs, new Date("2026-11-01T00:00:00Z"));
  assert.equal(p.window.prs, 14);
  assert.equal(p.maintainers, 1);
  assert.deepEqual([p.outside.merged.count, p.outside.merged.of, p.outside.closed, p.outside.open.count], [6, 12, 5, 1]);
  assert.equal(p.outside.merged.examples.length, 3);
  assert.deepEqual([p.outside.medianLinesMerged, p.outside.medianLinesClosed], [25, 305]);
  assert.deepEqual([p.outside.testsMerged.count, p.outside.testsClosed.count], [6, 0]);
  assert.deepEqual([p.outside.linkedMerged.count, p.outside.linkedClosed.count], [6, 0]);
  assert.equal(p.outside.medianDaysToMerge, 2);
  assert.deepEqual(p.closeReasons.map((r) => [r.reason, r.count, r.of]), [["discuss_first", 5, 5]]);
  assert.deepEqual(p.reviewAsks.map((a) => [a.ask, a.count, a.of]), [["changelog", 6, 11]]);
  assert.equal(p.medianFirstResponseHours, 24);
  assert.equal(p.conventions.title, "conventional");
  assert.ok(!JSON.stringify(p).includes("contributor"), "no logins in the profile");
});

test("findings need enough PRs, and a review request must recur before it is a norm", () => {
  const few = summarizeProfile("acme/app", [pr(), closedPr()]);
  assert.ok(few.outside.merged.of < MIN_SAMPLE);
  assert.equal(profileFindings(few).filter((f) => f.section === "outcomes").length, 0, "two PRs say nothing about outcomes");

  const prs = [
    ...Array.from({ length: 5 }, (_, i) => pr({ tests: true, reviewSays: [i < 2 ? "Please run pre-commit." : "LGTM"] })),
    ...Array.from({ length: 5 }, () => closedPr({ maintainerSays: ["Duplicate of #1."] })),
    pr({ state: "OPEN" }),
  ];
  const findings = profileFindings(summarizeProfile("acme/app", prs));
  const outcome = findings.find((f) => f.text.startsWith("Of 11 PRs"));
  assert.equal(outcome?.text, "Of 11 PRs outside contributors opened 1–4 months ago, 5 were merged (45%), 5 closed and 1 is still open.");
  assert.equal(outcome?.examples.length, 3);
  assert.ok(findings.some((f) => f.text === "100% of merged outside PRs touched tests, against 0% of closed ones."));
  assert.ok(findings.some((f) => f.section === "closed" && f.text.includes("a duplicate") && f.examples.length === 3));
  assert.ok(!findings.some((f) => f.section === "review"), "asked on 2 PRs: not a norm yet");
});

const ADVICE: Array<[string, Array<[CloseReason, number]>, string | null]> = [
  ["assignment, recurring", [["not_assigned", 23], ["duplicate", 2]], "not_assigned"],
  ["discussion, recurring", [["discuss_first", 4]], "discuss_first"],
  ["both: assignment comes first", [["discuss_first", 9], ["not_assigned", 3]], "not_assigned"],
  ["below the repeat threshold", [["not_assigned", 2], ["discuss_first", 2]], null],
  ["other reasons only", [["stale", 9], ["duplicate", 5]], null],
];
for (const [name, reasons, expected] of ADVICE) {
  test(`engagement advice: ${name} → ${expected}`, () => {
    const p = summarizeProfile("acme/app", []);
    p.closeReasons = reasons.map(([reason, count]) => ({ reason, count, of: 32, examples: [] }));
    const advice = engagementAdvice(p);
    assert.equal(advice?.reason ?? null, expected);
    if (advice) {
      assert.equal(advice.of, 32);
      assert.match(advice.comment, /^Hi! .*<one or two sentences on the fix>/, "a draft the contributor finishes");
    }
  });
}

test("an empty repository has an empty profile, not an error", () => {
  const p = summarizeProfile("acme/empty", []);
  assert.deepEqual([p.window.prs, p.window.from, p.outside.merged.of, p.medianFirstResponseHours], [0, null, 0, null]);
  assert.deepEqual(profileFindings(p), []);
});

test("the window is read in non-overlapping slices from 30 to 120 days ago", () => {
  const queries = cohortQueries("acme", "app", new Date("2026-11-05T12:00:00Z"));
  assert.equal(queries.length, COHORT_SLICES);
  assert.deepEqual(queries.map((q) => /created:(\S+)/.exec(q)?.[1]), [
    "2026-09-06..2026-10-06", "2026-08-07..2026-09-05", "2026-07-08..2026-08-06",
  ]);
  assert.ok(queries.every((q) => q.startsWith("repo:acme/app is:pr ") && q.endsWith(" sort:created-desc")));
});

/** A fake client answering each slice's search with `pages[i]`, and the AI
 *  policy query with `policy` as the contributing guide. `calls` holds the searches. */
function client(pages: ProfilePr[][] | null | Error, policy?: string | Error) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      async graphql(_query: string, variables: Record<string, unknown>) {
        if (pages instanceof Error) throw pages;
        if (variables.q === undefined) {
          if (policy instanceof Error) throw policy;
          // lib/ai-policy.ts: d0 lists the root, then f0 reads CONTRIBUTING.md.
          return { repository: { d0: { entries: [{ name: "CONTRIBUTING.md", type: "blob", mode: 33188 }] }, f0: policy ? { text: policy } : null } };
        }
        calls.push(variables);
        if (pages === null) return { repository: null, search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
        // Search can return non-PR hits as empty objects; they are dropped.
        const nodes = [...(pages[calls.length - 1] ?? []), {} as ProfilePr];
        return { repository: { nameWithOwner: "Acme/App" }, search: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
      },
    } as unknown as GitHubClient,
  };
}

test("fetching asks once per slice and names the repository as GitHub does", async () => {
  const fake = client([[pr(), pr()], [closedPr()], []]);
  const p = await fetchRepoProfile(fake.client, "acme/app", new Date("2026-11-05T12:00:00Z"));
  assert.equal(p.repo, "Acme/App");
  assert.equal(p.window.prs, 3);
  assert.equal(fake.calls.length, COHORT_SLICES);
  assert.ok(fake.calls.every((c) => c.n === 34));
});

test("a moved repository is searched under its new name (search doesn't follow the move)", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const moved = {
    async graphql(_query: string, variables: Record<string, unknown>) {
      if (variables.q === undefined) return { repository: {} }; // the AI policy read
      calls.push(variables);
      const current = variables.owner === "facebook";
      return { repository: { nameWithOwner: "react/react" }, search: { nodes: current ? [] : [pr()], pageInfo: { hasNextPage: false, endCursor: null } } };
    },
  } as unknown as GitHubClient;
  const p = await fetchRepoProfile(moved, "facebook/react", new Date("2026-11-05T12:00:00Z"));
  assert.equal(p.repo, "react/react");
  assert.equal(p.window.prs, COHORT_SLICES, "every slice read under the new name");
  assert.equal(calls.length, COHORT_SLICES + 1);
  assert.ok(calls.slice(1).every((c) => String(c.q).startsWith("repo:react/react ")));
});

test("the project's AI policy leads the profile, quoted; an unreadable one is said so", async () => {
  const ban = ["## AI policy", "", "No LLMs for issues, pull requests, or comments on the bug tracker."].join("\n");
  const banned = await fetchRepoProfile(client([[pr()], [], []], ban).client, "acme/app", new Date("2026-11-05T12:00:00Z"));
  assert.equal(banned.aiPolicy?.stance, "banned");
  const [first] = profileFindings(banned);
  assert.equal(first.section, "start");
  assert.ok(first.text.startsWith('This project does not accept AI-generated contributions (CONTRIBUTING.md: "No LLMs'), first.text);

  const silent = await fetchRepoProfile(client([[pr()], [], []]).client, "acme/app");
  assert.equal(profileFindings(silent)[0].text, "No AI policy in its contributing guide or PR template: disclose AI assistance anyway.");

  const unread = await fetchRepoProfile(client([[pr()], [], []], new Error("rate limited")).client, "acme/app");
  assert.equal(unread.aiPolicy, null);
  assert.match(profileFindings(unread)[0].text, /could not be read/);
});

test("a missing repository and a GitHub failure are named errors", async () => {
  await assert.rejects(fetchRepoProfile(client(null).client, "acme/gone"), RepoNotFoundError);
  await assert.rejects(fetchRepoProfile(client(new Error("rate limited")).client, "acme/app"), RepoProfileFetchError);
  await assert.rejects(fetchRepoProfile(client([]).client, "not a repo"), /repo/i);
});

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

test("the profile is stored on the repo's row and reused for a day, whatever the case of the name", async () => {
  const db = connection.db;
  const first = client([[pr()], [], []]);
  const p = await repoProfile(db, first.client, "acme/app", { now: new Date("2026-11-01T00:00:00Z") });
  assert.equal(first.calls.length, COHORT_SLICES);
  assert.deepEqual(await storedProfile(db, "Acme", "App"), p);

  const again = client([[pr(), pr()], [], []]);
  assert.equal((await repoProfile(db, again.client, "ACME/app", { now: new Date("2026-11-01T12:00:00Z") })).window.prs, 1);
  assert.equal(again.calls.length, 0, "fresh: no GitHub call");

  const later = await repoProfile(db, again.client, "acme/app", { now: new Date("2026-11-02T01:00:00Z") });
  assert.equal(later.window.prs, 2, "a day later it is read again");
  assert.equal((await storedProfile(db, "Acme", "App"))?.window.prs, 2);
});
