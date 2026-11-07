import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidRepoNameError } from "../ai-policy";
import type { GitHubClient } from "../gh";
import {
  communityFindings, communityLinks, DISCUSSION_SAMPLE, fetchCommunity, MIN_SAMPLE, RepoCommunityFetchError, summarizeCommunity,
  type CommunityDiscussion, type CommunityKind,
} from "../repo-community";

// ---- Links -----------------------------------------------------------------

const LINKS: Array<[string, string, CommunityKind | null, string?]> = [
  ["Markdown discord.gg", "Chat: [Discord](https://discord.gg/abc123)", "discord", "https://discord.gg/abc123"],
  ["reST discord.com/invite", "`Discord <https://discord.com/invite/abc123>`_", "discord", "https://discord.com/invite/abc123"],
  ["discordapp.com/invite", "https://discordapp.com/invite/xyz", "discord"],
  ["HTML href", '<a href="https://discord.gg/q1">chat</a>', "discord", "https://discord.gg/q1"],
  ["bold, then a full stop", "Join **https://discord.gg/abc**.", "discord", "https://discord.gg/abc"],
  ["Slack invite", "[Slack](https://join.slack.com/t/proj/shared_invite/zt-1abc)", "slack"],
  ["a Slack workspace", "on https://myproject.slack.com, say hi", "slack", "https://myproject.slack.com"],
  ["reST target Zulip", ".. _Zulip: https://proj.zulipchat.com/#narrow/stream/1", "zulip"],
  ["Gitter room with badge query", "[![Gitter](https://badges.gitter.im/x.svg)](https://gitter.im/org/room?utm_source=badge)", "gitter", "https://gitter.im/org/room?utm_source=badge"],
  ["new Gitter", "https://app.gitter.im/#/room/#org_room:gitter.im", "gitter"],
  ["Matrix room", "(https://matrix.to/#/#proj:matrix.org)", "matrix", "https://matrix.to/#/#proj:matrix.org"],
  ["a discuss. host", "Ask on https://discuss.python.org/c/help/7.", "discourse", "https://discuss.python.org/c/help/7"],
  ["a discourse. host", "https://discourse.example.org/", "discourse"],
  ["a /t/ URL with Discourse nearby", "Our Discourse forum: https://forum.example.org/t/welcome/12", "discourse"],
  ["Google group", "<https://groups.google.com/g/proj-dev>", "mailing-list", "https://groups.google.com/g/proj-dev"],
  ["Mailman", "https://mail.python.org/mailman/listinfo/scipy-dev", "mailing-list"],
  ["Mailman 3 archives", "https://mail.python.org/archives/list/numpy@python.org/", "mailing-list"],
  ["lists. host", "https://lists.osgeo.org/pipermail/proj/", "mailing-list"],
  ["groups.io", "https://groups.io/g/proj", "mailing-list"],
  // Look-alikes that must not match.
  ["a Discord badge", "![Discord](https://img.shields.io/discord/1234?label=Discord)", null],
  ["Discord's developer docs", "https://discord.com/developers/docs", null],
  ["discord.gg with no invite", "https://discord.gg/", null],
  ["notdiscord.gg", "https://notdiscord.gg/abc", null],
  ["discord.gg as a subdomain", "https://discord.gg.evil.example/abc", null],
  ["Slack's API docs", "https://api.slack.com/apps", null],
  ["slack.com itself", "https://slack.com/", null],
  ["a host ending in slack.com", "https://evil-slack.com/x", null],
  ["a join.slack.com without /t/", "https://join.slack.com/", null],
  ["the Gitter badge alone", "https://badges.gitter.im/Join%20Chat.svg", null],
  ["matrix.to with no room", "https://matrix.to/", null],
  ["Discourse's own forum", "Built with Discourse: https://meta.discourse.org/t/x/1", null],
  ["a /t/ URL with no Discourse nearby", "See https://forum.example.org/t/welcome/12", null],
  ["zulipchat.com itself", "https://zulipchat.com/ and https://www.zulipchat.com/", null],
  ["GitHub Discussions", "https://github.com/org/repo/discussions", null],
  ["a page about mailboxes", "https://docs.python.org/3/library/mailbox.html", null],
  ["not a URL", "discord.gg/abc without a scheme", null],
];
for (const [name, text, kind, url] of LINKS) {
  test(`link: ${name} → ${kind ?? "none"}`, () => {
    const links = communityLinks([{ path: "README.md", text }]);
    if (kind === null) return assert.deepEqual(links, []);
    assert.equal(links.length, 1, JSON.stringify(links));
    assert.equal(links[0].kind, kind);
    assert.equal(links[0].source, "README.md");
    if (url) assert.equal(links[0].url, url);
  });
}

const DUPLICATES: Array<[string, Array<{ path: string; text: string }>, Array<[CommunityKind, string, string]>]> = [
  ["the same invite in two files: the first file wins", [
    { path: "README.md", text: "https://discord.gg/abc" },
    { path: "CONTRIBUTING.md", text: "[chat](https://discord.gg/abc)" },
  ], [["discord", "https://discord.gg/abc", "README.md"]]],
  ["discord.com/invite/x is discord.gg/x", [
    { path: "README.md", text: "https://discord.com/invite/abc and https://discord.gg/abc" },
  ], [["discord", "https://discord.com/invite/abc", "README.md"]]],
  ["a trailing slash and a case change are the same place", [
    { path: "README.rst", text: "https://Proj.slack.com/ then https://proj.slack.com" },
  ], [["slack", "https://Proj.slack.com/", "README.rst"]]],
  ["different places are kept, in order", [
    { path: "README.md", text: "https://proj.zulipchat.com https://discord.gg/a" },
    { path: ".github/SUPPORT.md", text: "https://discord.gg/b https://groups.google.com/g/proj" },
  ], [["zulip", "https://proj.zulipchat.com", "README.md"], ["discord", "https://discord.gg/a", "README.md"],
    ["discord", "https://discord.gg/b", ".github/SUPPORT.md"], ["mailing-list", "https://groups.google.com/g/proj", ".github/SUPPORT.md"]]],
  ["no files", [], []],
  ["an empty file", [{ path: "README", text: "" }], []],
];
for (const [name, files, expected] of DUPLICATES) {
  test(`links: ${name}`, () => {
    assert.deepEqual(communityLinks(files).map((l) => [l.kind, l.url, l.source]), expected);
  });
}

// ---- Discussions -----------------------------------------------------------

const DAY = 86_400_000;
const NOW = new Date("2026-11-05T12:00:00Z");
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY + hours * 3_600_000).toISOString();
const QA = { name: "Q&A", slug: "q-a", isAnswerable: true };
const IDEAS = { name: "Ideas", slug: "ideas", isAnswerable: false };

let n = 0;
type Reply = { login: string; association?: string; hours: number; nested?: boolean; bot?: boolean };
type Opts = { login?: string; association?: string; category?: typeof QA; answered?: boolean; days?: number; replies?: Reply[]; chosenBy?: string };
/** A discussion `days` ago (default 60) from an outside contributor, with `replies` `hours` after it opened. */
function discussion(o: Opts = {}): CommunityDiscussion {
  n++;
  const days = o.days ?? 60;
  const category = o.category ?? QA;
  const post = (r: Reply) => ({
    createdAt: ago(days, r.hours), authorAssociation: r.association ?? "NONE",
    author: { login: r.login, ...(r.bot ? { __typename: "Bot" } : {}) },
  });
  const replies = o.replies ?? [];
  return {
    url: `https://github.com/acme/app/discussions/${n}`, createdAt: ago(days),
    authorAssociation: o.association ?? "NONE", author: { login: o.login ?? `asker${n}` },
    isAnswered: category.isAnswerable ? o.answered ?? false : null, category,
    answerChosenBy: o.chosenBy ? { login: o.chosenBy } : null,
    comments: {
      nodes: [
        { ...post({ login: "passer-by", hours: 0.5 }), replies: { nodes: replies.filter((r) => r.nested).map(post) } },
        ...replies.filter((r) => !r.nested).map((r) => ({ ...post(r), replies: { nodes: [] } })),
      ],
    },
  };
}
const OWNER: Reply = { login: "owner", association: "OWNER", hours: 4 };
const summarize = (discussions: CommunityDiscussion[], extra: string[] = [], total = discussions.length) =>
  summarizeCommunity("acme/app", { enabled: true, total, discussions, files: [] }, NOW, extra);

test("discussions: outside ones measured for replies, answers and reply time; categories over all", () => {
  const discussions = [
    ...Array.from({ length: 4 }, () => discussion({ answered: true, replies: [OWNER] })),
    discussion({ replies: [{ login: "private-member", hours: 10 }] }), // a maintainer only the profile knows
    discussion({ replies: [{ ...OWNER, hours: 30, nested: true }] }), // a nested reply counts
    discussion({ category: IDEAS }),
    discussion({ category: IDEAS, replies: [{ login: "helper", association: "CONTRIBUTOR", hours: 1 }] }),
    discussion({ login: "owner", association: "OWNER", category: IDEAS }), // an announcement: not outside
    discussion({ login: "renovate[bot]", category: IDEAS }),
    discussion({ replies: [{ login: "owner", association: "OWNER", hours: -1 }] }), // before it opened: clock skew, ignored
  ];
  const c = summarize(discussions, ["private-member"]);
  const d = c.discussions!;
  assert.deepEqual([d.window.discussions, d.outside], [11, 9]);
  assert.deepEqual([d.maintainerReply.count, d.maintainerReply.of], [6, 9]);
  assert.equal(d.maintainerReply.examples.length, 3);
  assert.deepEqual([d.answered.count, d.answered.of], [4, 7]);
  assert.equal(d.medianHoursToMaintainerReply, 4);
  assert.deepEqual(d.categories.map((x) => [x.name, x.count, x.answerable, x.url]), [
    ["Q&A", 7, true, "https://github.com/acme/app/discussions/categories/q-a"],
    ["Ideas", 4, false, "https://github.com/acme/app/discussions/categories/ideas"],
  ]);
  assert.ok(!/asker|owner|private-member|helper/.test(JSON.stringify(c)), "no logins in the signal");

  const without = summarize(discussions).discussions!;
  assert.equal(without.maintainerReply.count, 5, "without the extra login, its reply is not a maintainer's");
});

test("discussions: whoever chose the answer to someone else's question is a maintainer", () => {
  const triager = { login: "triager", hours: 2 };
  const d = summarize([discussion({ answered: true, chosenBy: "triager", replies: [triager] }), discussion({ replies: [triager] })]).discussions!;
  assert.equal(d.maintainerReply.count, 2);
  const own = summarize([discussion({ login: "self", chosenBy: "self", replies: [{ login: "self", hours: 1 }] })]).discussions!;
  assert.equal(own.maintainerReply.count, 0, "answering your own question is not maintaining");
});

test("discussions off, unused, and none old enough are each said plainly", () => {
  const off = summarizeCommunity("acme/app", { enabled: false, total: 0, discussions: [], files: [] }, NOW);
  assert.equal(off.discussions, null);
  assert.deepEqual(communityFindings(off).map((f) => f.text), ["GitHub Discussions are turned off for this repository."]);

  const unused = summarize([]);
  assert.deepEqual([unused.discussions!.window.from, unused.discussions!.outside, unused.discussions!.total, unused.discussions!.medianHoursToMaintainerReply], [null, 0, 0, null]);
  assert.deepEqual(communityFindings(unused).map((f) => f.text), ["GitHub Discussions are on, but nobody has opened one."]);

  const young = summarize([], [], 4);
  assert.deepEqual(communityFindings(young).map((f) => f.text), ["GitHub Discussions are on, but no discussion is old enough (a month) to measure."]);
});

test("findings: rates need MIN_SAMPLE discussions, the reply time MIN_SAMPLE replies", () => {
  const few = summarize(Array.from({ length: MIN_SAMPLE - 1 }, () => discussion({ answered: true, replies: [OWNER] })));
  assert.deepEqual(communityFindings(few), [], "four discussions say nothing");

  const some = summarize([
    ...Array.from({ length: 3 }, () => discussion({ answered: true, replies: [OWNER] })),
    ...Array.from({ length: 3 }, () => discussion({ category: IDEAS })),
  ]);
  const texts = communityFindings(some).map((f) => f.text);
  assert.ok(texts.includes("Of 6 GitHub Discussions outside contributors opened in September 2026, 3 got a maintainer reply (50%)."), texts.join("\n"));
  assert.ok(!texts.some((t) => t.includes("questions")), "3 questions: too few for a rate");
  assert.ok(!texts.some((t) => t.includes("first replies")), "3 replies: too few for a median");

  const many = summarize(Array.from({ length: 6 }, (_, i) => discussion({ days: 40 + i * 30, answered: i < 4, replies: [OWNER] })));
  const findings = communityFindings(many);
  assert.deepEqual(findings.map((f) => f.text), [
    "Of 6 GitHub Discussions outside contributors opened between April 2026 and September 2026, 6 got a maintainer reply (100%).",
    "4 of 6 questions (Q&A category) were marked answered (67%).",
    "In Discussions, a maintainer usually first replies within about 4 hours.",
    "The busiest Discussions categories are Q&A (6), of 6 discussions.",
  ]);
  assert.equal(findings[0].examples.length, 3);
  assert.deepEqual(findings[3].examples, ["https://github.com/acme/app/discussions/categories/q-a"]);
});

test("findings: one per kind of link, with the files they came from", () => {
  const c = summarizeCommunity("acme/app", { enabled: false, total: 0, discussions: [], files: [
    { path: "README.md", text: "https://discord.gg/a https://discord.gg/b https://groups.google.com/g/x" },
    { path: "CONTRIBUTING.md", text: "https://discord.gg/c https://discord.gg/d" },
  ] }, NOW);
  const findings = communityFindings(c).slice(1);
  assert.deepEqual(findings.map((f) => f.text), [
    "The project links 4 Discord servers from README.md and CONTRIBUTING.md.",
    "The project links a mailing list from README.md.",
  ]);
  assert.deepEqual(findings[0].examples, ["https://discord.gg/a", "https://discord.gg/b", "https://discord.gg/c"]);
});

// ---- Fetch -----------------------------------------------------------------

type Repo = { enabled?: boolean; nodes?: CommunityDiscussion[]; totalCount?: number; files?: Record<string, string>; name?: string };
/** A fake client: the main query answers from `repo` (files keyed by path),
 *  the window search with `search`, the symlink read from `targets`. */
function client(repo: Repo | null | Error, search: CommunityDiscussion[] = [], targets: Record<string, string> = {}) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const filesFrom = (query: string, files: Record<string, string>) => Object.fromEntries(
    [...query.matchAll(/(f\d+): object\(expression: "HEAD:([^"]+)"\)/g)].map(([, alias, path]) => [alias, path in files ? { text: files[path] } : null]));
  return {
    calls,
    client: {
      async graphql(query: string, variables: Record<string, unknown>) {
        calls.push({ query, variables });
        if (repo instanceof Error) throw repo;
        if (query.includes("RepoCommunityWindow")) return { search: { nodes: [...search, {}] } }; // non-discussion hits are empty objects
        if (repo === null) return { repository: null };
        if (query.includes("RepoCommunityFiles")) return { repository: filesFrom(query, targets) };
        const nodes = repo.nodes ?? [];
        return {
          repository: {
            nameWithOwner: repo.name ?? "Acme/App", hasDiscussionsEnabled: repo.enabled ?? true,
            discussions: { totalCount: repo.totalCount ?? nodes.length, nodes },
            ...filesFrom(query, repo.files ?? {}),
          },
        };
      },
    } as unknown as GitHubClient,
  };
}

test("fetch: discussions a month old or more, links from README and a symlinked guide, under GitHub's name", async () => {
  const fake = client({
    nodes: [discussion({ days: 3 }), discussion({ days: 45, replies: [OWNER] }), discussion({ days: 400 })],
    files: { "README.md": "Chat: https://discord.gg/abc", "CONTRIBUTING.md": "docs/contributing.md", ".github/SUPPORT.md": "https://discord.gg/abc" },
  }, [], { "docs/contributing.md": "Ask on https://proj.zulipchat.com" });
  const c = await fetchCommunity(fake.client, "acme", "app", NOW);
  assert.equal(c.repo, "Acme/App");
  assert.equal(c.discussions?.window.discussions, 2, "the 3-day-old one has not had time");
  assert.equal(c.discussions?.total, 3);
  assert.equal(c.discussions?.maintainerReply.count, 1);
  assert.deepEqual(c.links.map((l) => [l.kind, l.source]), [["discord", "README.md"], ["zulip", "docs/contributing.md"]]);
  assert.equal(fake.calls.length, 2, "main query, then the symlink target; no search");
  assert.equal(fake.calls[0].variables.n, 100);
  assert.ok(fake.calls[0].query.includes('"HEAD:.github/SUPPORT.md"') && fake.calls[0].query.includes('"HEAD:README.rst"'));
});

test("fetch: a busy repository whose newest page is all under a month old is read by date window instead", async () => {
  const young = Array.from({ length: 100 }, () => discussion({ days: 5 }));
  const fake = client({ nodes: young, totalCount: 900 }, [discussion({ days: 50 }), discussion({ days: 90 }), discussion({ days: 10 })]);
  const c = await fetchCommunity(fake.client, "acme", "app", NOW);
  assert.equal(c.discussions?.window.discussions, 2);
  const q = String(fake.calls[1].variables.q);
  assert.equal(q, "repo:Acme/App created:2026-07-08..2026-10-06");
  assert.equal(fake.calls[1].variables.n, DISCUSSION_SAMPLE);
});

test("fetch: Discussions off still reads the links, and skips the search", async () => {
  const fake = client({ enabled: false, files: { "README.rst": "`Slack <https://join.slack.com/t/proj/shared_invite/zt-1>`_" } });
  const c = await fetchCommunity(fake.client, "acme", "app", NOW);
  assert.equal(c.discussions, null);
  assert.deepEqual(c.links.map((l) => l.kind), ["slack"]);
  assert.equal(fake.calls.length, 1);
});

const FAILURES: Array<[string, () => ReturnType<typeof client>, string, string, RegExp | (new (...a: never[]) => Error)]> = [
  ["GitHub failing", () => client(new Error("rate limited")), "acme", "app", RepoCommunityFetchError],
  ["a missing repository", () => client(null), "acme", "gone", RepoCommunityFetchError],
  ["a bad owner", () => client({}), "not a repo", "app", InvalidRepoNameError],
  ["an empty name", () => client({}), "acme", "", InvalidRepoNameError],
];
for (const [name, make, owner, repo, error] of FAILURES) {
  test(`fetch: ${name} is a named error, not an empty result`, async () => {
    const fake = make();
    await assert.rejects(fetchCommunity(fake.client, owner, repo, NOW), error);
    if (error === InvalidRepoNameError) assert.equal(fake.calls.length, 0, "checked before any call");
  });
}

test("fetch: a failure on the symlink read is an error too", async () => {
  let calls = 0;
  const flaky = {
    async graphql() {
      if (++calls > 1) throw new Error("timeout");
      return { repository: { nameWithOwner: "acme/app", hasDiscussionsEnabled: false, discussions: { totalCount: 0, nodes: [] }, f0: { text: "docs/README.md" } } };
    },
  } as unknown as GitHubClient;
  await assert.rejects(fetchCommunity(flaky, "acme", "app", NOW), RepoCommunityFetchError);
});
