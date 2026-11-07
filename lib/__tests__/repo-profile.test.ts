import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import type { GitHubClient } from "../gh";
import {
  askedFor, closeReason, cohortQueries, COHORT_SLICES, COHORT_WINDOWS, engagementAdvice, fetchRepoProfile, maintainersOf, MIN_SAMPLE, prType,
  profileFindings, repoProfile, RepoNotFoundError, RepoProfileFetchError, storedProfile, summarizeProfile, windowText,
  type CloseReason, type PrType, type ProfilePr, type RepoProfile,
} from "../repo-profile";

const MAINT = { login: "maint" };
const T0 = "2026-10-01T00:00:00Z";
const hoursAfter = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();
const say = (body: string, author: { login: string; __typename?: string } = MAINT, authorAssociation = "CONTRIBUTOR", createdAt = "2026-10-02T00:00:00Z") =>
  ({ createdAt, body, authorAssociation, author });

let n = 0;
type Opts = Partial<ProfilePr> & { maintainerSays?: string[]; reviewSays?: string[]; tests?: boolean; issue?: boolean; login?: string; paths?: string[] };
/** A PR from an outside contributor, merged by "maint" unless `state` says otherwise. */
function pr(o: Opts = {}): ProfilePr {
  n++;
  const login = o.login ?? `contributor${n}`;
  const state = o.state ?? "MERGED";
  return {
    number: n, url: `https://github.com/acme/app/pull/${n}`, title: `fix: thing ${n}`, state,
    mergedBy: state === "MERGED" ? MAINT : null,
    createdAt: T0, closedAt: state === "OPEN" ? null : "2026-10-03T00:00:00Z", mergedAt: state === "MERGED" ? "2026-10-03T00:00:00Z" : null,
    additions: 20, deletions: 5, changedFiles: 2, authorAssociation: "CONTRIBUTOR", author: { login },
    labels: { nodes: [] }, closingIssuesReferences: { totalCount: o.issue ? 1 : 0 },
    files: { nodes: (o.paths ?? ["src/a.py", ...(o.tests ? ["tests/test_a.py"] : [])]).map((path) => ({ path })) },
    commits: { nodes: [{ commit: { message: "fix" } }] },
    reviews: { nodes: (o.reviewSays ?? []).map((body) => ({ ...say(body), comments: { nodes: [] } })) },
    comments: { nodes: (o.maintainerSays ?? []).map((body) => say(body)) },
    // Closed PRs are closed by the maintainer unless a test says otherwise.
    timelineItems: { nodes: state === "CLOSED" ? [{ actor: MAINT }] : [] },
    ...o,
  };
}
const closedPr = (o: Opts = {}) => pr({ state: "CLOSED", ...o });
const openPr = (o: Opts = {}) => pr({ state: "OPEN", ...o });
/** Closed by its own author ("self"), with these comments. */
const withdrawn = (comments: ReturnType<typeof say>[]) => closedPr({ login: "self", timelineItems: { nodes: [{ actor: { login: "self" } }] }, comments: { nodes: comments } });
const SELF = { login: "self" };
const TEAM = new Set(["maint"]);
const BOT = { login: "github-actions", __typename: "Bot" };

const REASONS: Array<[string, ProfilePr | Opts, CloseReason]> = [
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
  // pyjanitor #1743: the author closed it, after the maintainer said this.
  ["a maintainer already on it (pyjanitor #1743)", withdrawn([
    say("thanks @SumanGouda however i'm already working on this; i should have been much clearer when replying to your message on the issue."),
    say("> thanks @SumanGouda however i'm already working on this\r\n\r\nThanks for letting me know! I'll close my PR and hold off.", SELF),
  ]), "in_progress"],
  ["earmarked for deprecation (pyjanitor #1722)", withdrawn([
    say("@tunglambk this function is earmarked for deprecation "),
    say("Understood, and thanks for the context. I'll close this rather than leave it in your queue.", SELF),
  ]), "deprecated"],
  ["redirected to another project (pyjanitor #1714)", withdrawn([
    say("Thanks @be-student ideally if we can make it generic for all pyjanitor functions "),
    say("agreed, @be-student definitely appreciate your contributions on this one! Would you be kind enough to redirect the PR to pandas-flavor please?"),
  ]), "elsewhere"],
  ["the author's own last word says why", withdrawn([
    say("Thanks, ideally we make it generic for all functions."),
    say("Closing this PR because the maintainers asked that the change be redirected to pandas-flavor.", SELF),
  ]), "elsewhere"],
  ["the author closing it after a maintainer commented", withdrawn([say("Could you add a test?"), say("I don't have time, sorry.", SELF)]), "author_withdrew_after_feedback"],
  ["a maintainer review before the author closed it", closedPr({ login: "self", timelineItems: { nodes: [{ actor: SELF }] }, reviewSays: ["Needs a different approach."] }), "author_withdrew_after_feedback"],
  ["the author closing it with nobody answering", { login: "self", timelineItems: { nodes: [{ actor: SELF }] } }, "author_withdrew"],
  ["an author mentioning ChatGPT is not called out", withdrawn([say("I used ChatGPT for this, closing.", SELF)]), "author_withdrew"],
  ["nothing said", {}, "unexplained"],
];
for (const [name, given, expected] of REASONS) {
  test(`close reason: ${name} → ${expected}`, () => {
    const subject = "number" in given ? given as ProfilePr : closedPr(given);
    assert.equal(closeReason(subject, TEAM), expected);
  });
}

test("close reason: only maintainers' and bots' words count, unless the author closed it themselves", () => {
  const own = closedPr({ login: "me", comments: { nodes: [say("duplicate of #3, sorry", { login: "me" })] } });
  assert.equal(closeReason(own, TEAM), "unexplained", "closed by a maintainer: the author's words don't explain it");
  const passerBy = closedPr({ comments: { nodes: [say("this is out of scope imo", { login: "someone" })] } });
  assert.equal(closeReason(passerBy, TEAM), "unexplained");
});

const ASKS: Array<[string, RegExp, boolean]> = [
  ["Please add a changelog entry.", /changelog/i, true],
  ["The changelog entry is missing.", /changelog/i, true],
  ["Don't forget the changelog!", /changelog/i, true],
  ["Could you update the docstring?", /docstring/i, true],
  // pyjanitor: mentions, not requests.
  ["Thanks @x, credited you in the changelog.", /changelog/i, false],
  ["I probably should have spent more time on the documentation back when I wrote the code, so thanks for this.", /documentation/i, false],
  // The request is in another sentence.
  ["Great docstring. Could you fix the typo in the title?", /docstring/i, false],
  ["", /changelog/i, false],
];
for (const [text, re, expected] of ASKS) {
  test(`askedFor: ${JSON.stringify(text)} → ${expected}`, () => assert.equal(askedFor(text, re), expected));
}

test("review asks: mentions and quoted text don't count, and a request must recur", () => {
  const prs = [
    ...Array.from({ length: 3 }, () => pr({ reviewSays: ["Thanks! Credited you in the changelog."] })),
    ...Array.from({ length: 2 }, () => pr({ reviewSays: ["> please add a changelog entry\n\nDone, thanks!"] })),
    pr({ reviewSays: ["Please add a changelog entry."] }),
  ];
  const p = summarizeProfile("acme/app", prs);
  assert.deepEqual(p.reviewAsks.map((a) => [a.ask, a.count]), [["changelog", 1]]);
  assert.ok(!profileFindings(p).some((f) => f.section === "review"), "one request is not a norm");
});

const TYPES: Array<[string[], PrType | null, string?]> = [
  [["docs/index.md", "README.rst"], "docs"],
  [["docs/api.md", "CHANGELOG.md"], "docs"],
  [["locales/es/LC_MESSAGES/index.po"], "translation"],
  [["locales/es/LC_MESSAGES/index.po", "docs/index.md"], "docs"],
  [["tests/test_a.py"], "tests"],
  [["tests/test_a.py", "CHANGELOG.md"], "tests"],
  [["src/a.py", "docs/a.md"], "code"],
  [["requirements.txt"], "code"],
  [["CHANGELOG.md"], "docs"],
  [[], null],
  // A docstring fix touches code files; its title says docs (pyjanitor).
  [["janitor/functions/conditional_join.py"], "docs", "[DOC] Document the parameters"],
  [["janitor/functions/conditional_join.py", "pixi.lock"], "docs", "docs: reorganize conditional_join"],
  [["janitor/a.py", "tests/test_a.py"], "code", "docs: and a test"],
  [["janitor/a.py"], "code", "Docstring tweaks"],
];
for (const [paths, expected, title] of TYPES) {
  test(`prType: ${JSON.stringify(paths)}${title ? ` "${title}"` : ""} → ${expected}`, () =>
    assert.equal(prType({ title, files: { nodes: paths.map((path) => ({ path })) } }), expected));
}

test("maintainers are who merged or closed others' PRs, even when GitHub calls them CONTRIBUTOR", () => {
  const team = maintainersOf([
    pr({ mergedBy: { login: "alex" } }), // alex merges: a maintainer with private membership
    closedPr({ timelineItems: { nodes: [{ actor: { login: "triager" } }] } }),
    closedPr({ login: "self", timelineItems: { nodes: [{ actor: { login: "self" } }] } }), // closing your own PR is not maintaining
    pr({ authorAssociation: "MEMBER", login: "member" }),
    pr({ mergedBy: { login: "merge-bot[bot]", __typename: "Bot" } }),
    pr({ mergedBy: { login: "pyup-bot", __typename: "User" } }), // a bot on a user account (earthpy)
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
    pr({ author: { login: "pyup-bot", __typename: "User" } }),
  ];
  const p = summarizeProfile("acme/app", prs, new Date("2026-11-01T00:00:00Z"));
  assert.equal(p.window.prs, 15);
  assert.deepEqual([p.window.minDays, p.window.maxDays], [30, 120]);
  assert.equal(p.maintainers, 1);
  assert.deepEqual([p.outside.merged.count, p.outside.merged.of, p.outside.closed, p.outside.open.count], [6, 12, 5, 1]);
  assert.equal(p.outside.merged.examples.length, 3);
  assert.deepEqual([p.outside.medianLinesMerged, p.outside.medianLinesClosed], [25, 305]);
  assert.deepEqual([p.outside.testsMerged.count, p.outside.testsClosed.count], [6, 0]);
  assert.deepEqual([p.outside.linkedMerged.count, p.outside.linkedClosed.count], [6, 0]);
  assert.equal(p.outside.medianDaysToMerge, 2);
  assert.deepEqual([p.outside.unanswered?.count, p.outside.unanswered?.of], [1, 12], "the open PR nobody answered");
  assert.deepEqual(p.closeReasons.map((r) => [r.reason, r.count, r.of]), [["discuss_first", 5, 5]]);
  assert.deepEqual(p.reviewAsks.map((a) => [a.ask, a.count, a.of]), [["changelog", 6, 11]]);
  assert.equal(p.medianFirstResponseHours, 24);
  assert.deepEqual(p.responseHours, { n: 11, q1: 24, median: 24, q3: 24 });
  assert.equal(p.conventions.title, "conventional");
  assert.deepEqual([p.conventions.titleFrom, p.conventions.titleTally?.count, p.conventions.titleTally?.of], ["outside", 6, 6]);
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

test("response time: two values (nbQA: 7 minutes and 84 days) are not a median; enough values give the spread", () => {
  const answeredAfter = (hours: number) => pr({ comments: { nodes: [say("Thanks!", MAINT, "MEMBER", hoursAfter(hours))] } });
  const nbqa = summarizeProfile("nbQA-dev/nbQA", [answeredAfter(7 / 60), answeredAfter(84 * 24)]);
  assert.equal(nbqa.medianFirstResponseHours, null);
  assert.deepEqual(nbqa.responseHours, { n: 2, q1: null, median: null, q3: null });
  assert.ok(!profileFindings(nbqa).some((f) => /responds/.test(f.text)));

  const busy = summarizeProfile("acme/app", [1, 2, 3, 10, 100].map(answeredAfter));
  assert.deepEqual(busy.responseHours, { n: 5, q1: 2, median: 3, q3: 10 });
  assert.ok(profileFindings(busy).some((f) => f.text ===
    "A maintainer usually first responds within about 3 hours (half of the 5 outside PRs that got a response); a quarter waited longer than about 10 hours."));
});

test("silence is stated at any sample size (earthpy: 3 outside PRs, none answered); one release PR is no changelog habit", () => {
  const prs = [
    openPr(), openPr(), openPr(),
    pr({ login: "maint", authorAssociation: "MEMBER", title: "release: v0.9.5", paths: ["CHANGELOG.rst", "setup.py"] }),
  ];
  const p = summarizeProfile("earthlab/earthpy", prs);
  const findings = profileFindings(p);
  const silent = findings.find((f) => f.text.includes("no comment or review"));
  assert.equal(silent?.text, "3 of 3 outside PRs opened 1–4 months ago got no comment or review from a maintainer.");
  assert.equal(silent?.examples.length, 3);
  assert.equal(p.conventions.changelogPath, null, "1 merged PR");
  assert.ok(!findings.some((f) => f.section === "conventions"));
});

test("unanswered: a merge, a maintainer's comment, a close for a stated reason, or comments not all read count as answered", () => {
  const botClosed = (body: string) => closedPr({ comments: { nodes: [say(body, BOT)] }, timelineItems: { nodes: [{ actor: BOT }] } });
  const p = summarizeProfile("acme/app", [
    pr(), closedPr(), openPr({ maintainerSays: ["Looking."] }),
    openPr({ comments: { totalCount: 9, nodes: [say("bump", { login: "x" })] } }),
    botClosed("You do not have permission to open a PR without being assigned to the issue."), // pydantic: answered by policy
    openPr({ comments: { nodes: [say("ping?", { login: "y" }), say("Thanks for the PR!", { login: "welcome", __typename: "Bot" })] } }), // silence
    botClosed("Closing: this PR is stale because it has had no activity."), // silence, then a stale bot
    withdrawn([say("Never mind.", SELF)]), // silence, then the author gave up
  ]);
  assert.deepEqual([p.outside.unanswered?.count, p.outside.unanswered?.of], [3, 8]);
});

test("titles: conventions need MIN_SAMPLE merged PRs (pyos-package-template: 2), and are read on outside PRs when there are enough (pyjanitor)", () => {
  assert.equal(summarizeProfile("acme/app", [pr({ title: "feat: a" }), pr({ title: "fix: b" })]).conventions.title, "none");

  const maintainers = Array.from({ length: 10 }, (_, i) => pr({ login: "maint", authorAssociation: "MEMBER", title: `Fix thing ${i}` }));
  const outside = Array.from({ length: 6 }, (_, i) => pr({ title: `[ENH] add thing ${i}` }));
  const pyjanitor = summarizeProfile("pyjanitor-devs/pyjanitor", [...maintainers, ...outside]);
  assert.equal(pyjanitor.conventions.title, "bracket");
  assert.ok(profileFindings(pyjanitor).some((f) => f.text === 'PR titles start with a tag in brackets ("[area] what changed") (6 of 6 merged outside PRs).' && f.examples.length === 3));

  const fallback = summarizeProfile("acme/app", [...Array.from({ length: 10 }, () => pr({ login: "maint", title: "fix: x" })), pr({ title: "[ENH] y" })]);
  assert.deepEqual([fallback.conventions.title, fallback.conventions.titleFrom, fallback.conventions.titleTally?.count, fallback.conventions.titleTally?.of], ["conventional", "all", 10, 11]);
});

test("changelog location needs MIN_SAMPLE merged PRs and MIN_REPEATS entries", () => {
  const prs = [...Array.from({ length: 3 }, () => pr({ paths: ["src/a.py", "CHANGELOG.md"] })), pr(), pr()];
  const p = summarizeProfile("acme/app", prs);
  assert.equal(p.conventions.changelogPath, "CHANGELOG.md");
  assert.ok(profileFindings(p).some((f) => f.text === "3 of 5 merged PRs added a changelog entry, in CHANGELOG.md."));
  const once = summarizeProfile("acme/app", [pr({ paths: ["CHANGELOG.md"] }), pr(), pr(), pr(), pr()]);
  assert.equal(once.conventions.changelogPath, null);
});

test("outcomes by what the PR changes (pyjanitor: docs-only 5 of 6 merged, code 2 of 7)", () => {
  const prs = [
    ...Array.from({ length: 6 }, (_, i) => pr({ paths: ["docs/index.md"], state: i < 5 ? "MERGED" : "CLOSED" })),
    ...Array.from({ length: 7 }, (_, i) => pr({ state: i < 2 ? "MERGED" : "CLOSED" })),
    pr({ paths: ["tests/test_a.py"] }), // too few to state
  ];
  const f = profileFindings(summarizeProfile("acme/app", prs)).find((x) => x.text.startsWith("By what they change"));
  assert.equal(f?.text, "By what they change, outside PRs were merged: docs-only 5 of 6 (83%), code changes 2 of 7 (29%).");
  assert.ok(f?.examples.every((u) => /\/pull\/\d+$/.test(u)) && f.examples.length === 3);
  const allCode = summarizeProfile("acme/app", Array.from({ length: 6 }, () => pr()));
  assert.ok(!profileFindings(allCode).some((x) => x.text.startsWith("By what they change")), "one type only: nothing to compare");
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

test("an empty repository says so, rather than looking quiet", () => {
  const p = summarizeProfile("acme/empty", []);
  assert.deepEqual([p.window.prs, p.window.from, p.outside.merged.of, p.medianFirstResponseHours], [0, null, 0, null]);
  assert.deepEqual(profileFindings(p).map((f) => [f.section, f.text]), [
    ["start", "No pull requests opened 1–4 months ago were found, so nothing here is measured from this project's PRs."],
  ]);
  const teamOnly = profileFindings(summarizeProfile("acme/app", [pr({ login: "maint" })]));
  assert.ok(teamOnly.some((f) => f.text === "1 of 1 PRs opened 1–4 months ago came from maintainers or bots; none from outside contributors."));
});

test("a version 1 profile (stored before the new fields) still reads", () => {
  const p = summarizeProfile("acme/app", Array.from({ length: 6 }, () => pr({ reviewSays: ["ok"] }))) as RepoProfile;
  const old = JSON.parse(JSON.stringify(p)) as RepoProfile;
  old.version = 1;
  delete old.responseHours; delete old.outside.unanswered; delete old.outside.byType; delete old.window.minDays; delete old.window.maxDays; delete old.window.opened;
  delete old.conventions.titleTally; delete old.conventions.titleFrom; delete old.conventions.changelogTally; delete old.status;
  const findings = profileFindings(old);
  assert.ok(findings.some((f) => f.text.startsWith("Of 6 PRs outside contributors opened 1–4 months ago")));
  assert.ok(findings.some((f) => f.text === 'PR titles follow Conventional Commits ("fix: …", "feat(scope): …").'));
  assert.ok(!findings.some((f) => /responds/.test(f.text)), "no sample size: no response time");
});

const WINDOWS: Array<[number, number, string]> = [[30, 120, "1–4 months ago"], [30, 365, "1–12 months ago"], [30, 730, "1–24 months ago"], [0, 10, "1–1 months ago"]];
for (const [min, max, expected] of WINDOWS) {
  test(`windowText(${min}, ${max}) → ${expected}`, () => assert.equal(windowText(min, max), expected));
}

test("the window is read in non-overlapping slices from 30 to 120 days ago, and wider windows the same way", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const queries = cohortQueries("acme", "app", now);
  assert.equal(queries.length, COHORT_SLICES);
  assert.deepEqual(queries.map((q) => /created:(\S+)/.exec(q)?.[1]), [
    "2026-09-06..2026-10-06", "2026-08-07..2026-09-05", "2026-07-08..2026-08-06",
  ]);
  assert.ok(queries.every((q) => q.startsWith("repo:acme/app is:pr ") && q.endsWith(" sort:created-desc")));
  assert.deepEqual(cohortQueries("acme", "app", now, COHORT_WINDOWS[2]).map((q) => /created:(\S+)/.exec(q)?.[1]), [
    "2026-02-15..2026-10-06", "2025-06-26..2026-02-14", "2024-11-05..2025-06-25",
  ]);
});

type Page = ProfilePr[] | { nodes: ProfilePr[]; issueCount?: number; hasNextPage?: boolean };
type Merge = Pick<ProfilePr, "url" | "mergedAt" | "authorAssociation" | "author" | "mergedBy">;
/** A fake client answering the i-th PR search with `pages[i]` (or pages(i, n)),
 *  the last-merge search with `merges`, and the AI policy query with `policy`
 *  as the contributing guide. `calls` holds the PR searches, `mergeCalls` the other. */
function client(pages: Page[] | ((i: number, n: number) => Page) | null | Error, policy?: string | Error, opts: { repository?: Record<string, unknown>; merges?: Merge[] } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const mergeCalls: Array<Record<string, unknown>> = [];
  return {
    calls,
    mergeCalls,
    client: {
      async graphql(_query: string, variables: Record<string, unknown>) {
        if (pages instanceof Error) throw pages;
        if (variables.q === undefined) {
          if (policy instanceof Error) throw policy;
          // lib/ai-policy.ts: d0 lists the root, then f0 reads CONTRIBUTING.md.
          return { repository: { d0: { entries: [{ name: "CONTRIBUTING.md", type: "blob", mode: 33188 }] }, f0: policy ? { text: policy } : null } };
        }
        if (String(variables.q).includes("is:merged")) {
          mergeCalls.push(variables);
          return { search: { nodes: [...(opts.merges ?? []), {}] } };
        }
        calls.push(variables);
        if (pages === null) return { repository: null, search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
        const page = typeof pages === "function" ? pages(calls.length - 1, Number(variables.n)) : pages[calls.length - 1] ?? [];
        const { nodes, issueCount, hasNextPage = false } = Array.isArray(page) ? { nodes: page, issueCount: undefined } : page;
        // Search can return non-PR hits as empty objects; they are dropped.
        return {
          repository: { nameWithOwner: "Acme/App", ...opts.repository },
          search: { issueCount, nodes: [...nodes, {} as ProfilePr], pageInfo: { hasNextPage, endCursor: hasNextPage ? `c${calls.length}` : null } },
        };
      },
    } as unknown as GitHubClient,
  };
}
const NOW = new Date("2026-11-05T12:00:00Z");

test("fetching asks once per slice, and keeps the narrowest window when reading further back adds nothing", async () => {
  const fake = client([[pr(), pr()], [closedPr()], []]);
  const p = await fetchRepoProfile(fake.client, "acme/app", NOW);
  assert.equal(p.repo, "Acme/App");
  assert.equal(p.window.prs, 3);
  assert.equal(p.window.maxDays, 120, "the wider windows added nothing");
  assert.equal(fake.calls.length, COHORT_WINDOWS.length * COHORT_SLICES);
  assert.ok(fake.calls.every((c) => c.n === 34));
  assert.equal(fake.mergeCalls.length, 0, "outside PRs were merged in the window");
});

test("a quiet project is read up to two years back (nbQA, earthpy), and the findings say so", async () => {
  const fake = client((i) => i < 3 ? (i === 0 ? [pr()] : []) : i < 6 ? [pr(), pr()] : [pr(), pr(), pr()]);
  const p = await fetchRepoProfile(fake.client, "acme/app", NOW);
  assert.equal(fake.calls.length, COHORT_WINDOWS.length * COHORT_SLICES);
  assert.deepEqual([p.window.minDays, p.window.maxDays, p.window.prs], [30, 730, 9]);
  assert.ok(String(fake.calls[6].q).includes("created:2026-02-15..2026-10-06"));
  assert.ok(profileFindings(p).some((f) => f.text.startsWith("Of 9 PRs outside contributors opened 1–24 months ago")));
});

test("a busy slice gets the budget quiet slices left, a page at a time, and the findings say what share was read", async () => {
  const fake = client((i, size) => i === 0 || i >= 3 ? { nodes: Array.from({ length: size }, () => pr()), issueCount: 120, hasNextPage: true } : i === 1 ? { nodes: [pr(), pr(), pr(), pr(), pr()], issueCount: 5 } : { nodes: [], issueCount: 0 });
  const p = await fetchRepoProfile(fake.client, "acme/app", NOW);
  assert.deepEqual(fake.calls.map((c) => c.n), [34, 34, 34, 50, 11]);
  assert.deepEqual(fake.calls.slice(3).map((c) => c.cursor), ["c1", "c4"]);
  assert.deepEqual([p.window.prs, p.window.opened], [100, 125]);
  assert.ok(profileFindings(p).some((f) => f.text.endsWith(" They come from the 100 PRs read of the 125 opened then.")));
});

test("a repository that takes no PRs on GitHub says so (movingpandas), and isn't read further back", async () => {
  const fake = client([], undefined, { repository: { nameWithOwner: "movingpandas/movingpandas", hasPullRequestsEnabled: false, homepageUrl: "http://movingpandas.org" } });
  const p = await fetchRepoProfile(fake.client, "movingpandas/movingpandas", NOW);
  assert.deepEqual(p.status, { pullRequestsEnabled: false, archived: false, mirror: false, elsewhere: null });
  assert.equal(fake.calls.length, COHORT_SLICES);
  assert.equal(fake.mergeCalls.length, 0);
  assert.deepEqual(profileFindings(p).slice(0, 2).map((f) => f.text), [
    "This repository doesn't accept pull requests on GitHub.",
    "No pull requests opened 1–4 months ago were found, so nothing here is measured from this project's PRs.",
  ]);
});

const STATUS: Array<[string, Record<string, unknown>, string | null]> = [
  ["moved to Codeberg", { hasPullRequestsEnabled: false, homepageUrl: "https://codeberg.org/acme/app" }, "This repository doesn't accept pull requests on GitHub; it points to https://codeberg.org/acme/app instead."],
  ["archived", { isArchived: true }, "This repository is archived (read-only)."],
  ["a mirror of SourceHut", { isMirror: true, mirrorUrl: "https://git.sr.ht/~acme/app" }, "This repository is a mirror; it points to https://git.sr.ht/~acme/app instead."],
  ["open for PRs, even with a GitLab homepage", { hasPullRequestsEnabled: true, homepageUrl: "https://gitlab.com/acme/app" }, null],
];
for (const [name, repository, expected] of STATUS) {
  test(`repository status: ${name}`, async () => {
    const p = await fetchRepoProfile(client([[pr()]], undefined, { repository }).client, "acme/app", NOW);
    const first = profileFindings(p)[0];
    if (expected) assert.deepEqual([first.section, first.text], ["start", expected]);
    else assert.ok(!profileFindings(p).some((f) => f.text.startsWith("This repository")));
  });
}

test("no outside merge in the window: the last one is looked up, leaving out maintainers and bots", async () => {
  const merge = (login: string, mergedAt: string, number: number, extra: Partial<Merge> = {}): Merge =>
    ({ url: `https://github.com/acme/app/pull/${number}`, mergedAt, authorAssociation: "CONTRIBUTOR", author: { login }, mergedBy: { login: "boss" }, ...extra });
  const fake = client([[openPr(), openPr()]], undefined, { merges: [
    merge("pyup-bot", "2026-09-01T00:00:00Z", 1),
    merge("boss", "2026-08-01T00:00:00Z", 2), // merged someone's PR: a maintainer
    merge("member", "2026-07-01T00:00:00Z", 3, { authorAssociation: "MEMBER" }),
    merge("outsider", "2023-03-05T10:00:00Z", 4),
    merge("older", "2022-01-01T00:00:00Z", 5),
  ] });
  const p = await fetchRepoProfile(fake.client, "acme/app", NOW);
  assert.equal(fake.mergeCalls.length, 1);
  assert.match(String(fake.mergeCalls[0].q), /^repo:Acme\/App is:pr is:merged sort:updated-desc$/);
  assert.deepEqual(p.lastOutsideMerge, { at: "2023-03-05T10:00:00Z", url: "https://github.com/acme/app/pull/4", checked: 5 });
  const f = profileFindings(p);
  assert.ok(f.some((x) => x.text === "No outside PR opened 1–4 months ago was merged; the last outside contributor's PR was merged on 5 March 2023." && x.examples[0].endsWith("/pull/4")));
  assert.ok(f.some((x) => x.text === "2 of 2 outside PRs opened 1–4 months ago got no comment or review from a maintainer."));

  const none = await fetchRepoProfile(client([[openPr()]], undefined, { merges: [merge("boss", "2026-08-01T00:00:00Z", 2)] }).client, "acme/app", NOW);
  assert.ok(profileFindings(none).some((x) => x.text === "No outside PR opened 1–4 months ago was merged, nor any of the 1 most recently updated merged PRs."));
  const never = await fetchRepoProfile(client([[]]).client, "acme/app", NOW);
  assert.ok(profileFindings(never).some((x) => x.text === "GitHub shows no merged pull requests in this repository."));
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
  const p = await fetchRepoProfile(moved, "facebook/react", NOW);
  assert.equal(p.repo, "react/react");
  assert.equal(p.window.prs, COHORT_SLICES, "every slice read under the new name");
  assert.equal(calls.length, COHORT_WINDOWS.length * COHORT_SLICES + 1, "every window, plus one read under the old name");
  assert.ok(calls.slice(1).every((c) => String(c.q).startsWith("repo:react/react ")));
});

test("the project's AI policy leads the profile, quoted; an unreadable one is said so", async () => {
  const ban = ["## AI policy", "", "No LLMs for issues, pull requests, or comments on the bug tracker."].join("\n");
  const banned = await fetchRepoProfile(client([[pr()], [], []], ban).client, "acme/app", NOW);
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

test("a failed last-merge search is a named error, not a silent gap", async () => {
  const failing = {
    async graphql(_query: string, variables: Record<string, unknown>) {
      if (String(variables.q).includes("is:merged")) throw new Error("rate limited");
      if (variables.q === undefined) return { repository: {} };
      return { repository: { nameWithOwner: "acme/app" }, search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    },
  } as unknown as GitHubClient;
  await assert.rejects(fetchRepoProfile(failing, "acme/app", NOW), RepoProfileFetchError);
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
  assert.equal(first.calls.length, COHORT_WINDOWS.length * COHORT_SLICES);
  assert.deepEqual(await storedProfile(db, "Acme", "App"), p);

  const again = client([[pr(), pr()], [], []]);
  assert.equal((await repoProfile(db, again.client, "ACME/app", { now: new Date("2026-11-01T12:00:00Z") })).window.prs, 1);
  assert.equal(again.calls.length, 0, "fresh: no GitHub call");

  const later = await repoProfile(db, again.client, "acme/app", { now: new Date("2026-11-02T01:00:00Z") });
  assert.equal(later.window.prs, 2, "a day later it is read again");
  assert.equal((await storedProfile(db, "Acme", "App"))?.window.prs, 2);
});
