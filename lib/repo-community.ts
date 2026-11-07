// Where a project talks, and how it answers: its GitHub Discussions (how many
// questions get a maintainer reply, how fast, which categories are busy) and
// the chat, forum and mailing-list links in its README, contributing guide and
// SUPPORT file.
//
// Measured, never guessed, like lib/repo-profile.ts: fixed patterns and
// counts, each finding with up to EXAMPLES links. Repository-level only: no
// logins or per-person figures. Public, sanctioned data only: Discord, Slack
// and the rest are linked, never read (their terms forbid scraping, and the
// people there didn't consent to it).

import { AI_POLICY_FILES, splitRepo, symlinkTarget } from "./ai-policy";
import type { GitHubClient } from "./gh";
import { isBotAuthor } from "./maintainer-prefs";
import { isMaintainer, median } from "./recs/health";
import type { Tally } from "./repo-profile";

// Same values as lib/repo-profile.ts. Copied, not imported: the profile is
// meant to import this module, and a value import back would be circular.
export const MIN_SAMPLE = 5;
export const EXAMPLES = 3;
const MIN_AGE_DAYS = 30;
const MAX_AGE_DAYS = 120;

/** Discussions measured: the newest this many at least MIN_AGE_DAYS old, so
 *  each has had a month to be answered. */
export const DISCUSSION_SAMPLE = 50;
/** Discussions read newest-first to find them. */
const DISCUSSION_PAGE = 100;
const MAX_FILE_CHARS = 200_000;

/** Files read for links. The contributing guides are the ones lib/ai-policy.ts reads. */
export const COMMUNITY_FILES = [
  "README.md", "README.rst", "README",
  ...AI_POLICY_FILES.filter((path) => /contributing/i.test(path)),
  "SUPPORT.md", ".github/SUPPORT.md", "docs/SUPPORT.md",
];

type Author = { login: string; __typename?: string } | null;
type Post = { createdAt: string; authorAssociation: string; author: Author };

export type CommunityDiscussion = Post & {
  url: string;
  /** null outside answerable (Q&A) categories. */
  isAnswered: boolean | null;
  category: { name: string; slug: string; isAnswerable: boolean };
  answerChosenBy: Author;
  comments: { nodes: Array<Post & { replies: { nodes: Post[] } | null }> } | null;
};

export const COMMUNITY_KINDS = ["discord", "slack", "zulip", "gitter", "matrix", "discourse", "mailing-list"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];
export type CommunityLink = { kind: CommunityKind; url: string; source: string };

/** `answerable`: a Q&A-style category, whatever its name (pydantic's "Question", Next.js's "Help"). */
export type Category = { name: string; url: string; answerable: boolean; count: number };

export type DiscussionStats = {
  /** Creation dates of the discussions measured, and how many. */
  window: { from: string | null; to: string | null; discussions: number };
  /** Every discussion the repository has: Discussions can be on and unused (pandas). */
  total: number;
  /** Opened by people outside the maintainer team, bots left out: what the rest measure. */
  outside: number;
  maintainerReply: Tally;
  /** Over outside discussions in answerable categories. */
  answered: Tally;
  medianHoursToMaintainerReply: number | null;
  /** Busiest first, over every discussion measured. */
  categories: Category[];
};

export type RepoCommunity = {
  version: 1;
  repo: string;
  computedAt: string;
  /** null when the repository has Discussions turned off. */
  discussions: DiscussionStats | null;
  links: CommunityLink[];
};

export class RepoCommunityFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s discussions and community files.`, { cause });
    this.name = "RepoCommunityFetchError";
  }
}

// ---- Links -----------------------------------------------------------------

// Stops at whitespace and at what closes a link in Markdown, reStructuredText
// and HTML: ) ] > and quotes.
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`|\\]+/gi;
const TRAILING = /[.,;:!?*_~]+$/;
/** slack.com subdomains that are Slack's own, not a workspace. */
const SLACK_OWN = new Set(["www", "api", "app", "status", "docs", "help", "get", "files", "slack-files", "downloads", "my", "join"]);

/** What a link points to, or null. `context` is the text around it, for the
 *  one case a host alone can't tell: a self-hosted Discourse. */
function linkKind(url: URL, context: string): CommunityKind | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  const path = url.pathname.replace(/\/+$/, "");
  if (host === "discord.gg" && path.length > 1) return "discord";
  if ((host === "discord.com" || host === "discordapp.com") && /^\/invite\/[\w-]+/i.test(path)) return "discord";
  if (host === "join.slack.com" && /^\/t\/[\w-]+/i.test(path)) return "slack";
  if (labels.length === 3 && host.endsWith(".slack.com") && !SLACK_OWN.has(labels[0])) return "slack";
  if (labels.length === 3 && host.endsWith(".zulipchat.com") && labels[0] !== "www") return "zulip";
  if ((host === "gitter.im" || host === "app.gitter.im") && (path.length > 1 || url.hash.startsWith("#/room/"))) return "gitter";
  if (host === "matrix.to" && /^#\/[#!@+]/.test(url.hash)) return "matrix";
  // Discourse's own site and forum are about Discourse, not the project.
  const vendor = host === "discourse.org" || host.endsWith(".discourse.org");
  if (!vendor && (labels[0] === "discuss" || labels.includes("discourse"))) return "discourse";
  if (!vendor && /^\/[ct]\/[\w-]+/.test(path) && /discourse/i.test(context)) return "discourse";
  if (host === "groups.google.com" && path.length > 1) return "mailing-list";
  if (host === "groups.io" && /^\/g\/[\w-]+/.test(path)) return "mailing-list";
  if (labels[0] === "lists" && labels.length >= 3) return "mailing-list";
  if (/^\/(mailman3?|pipermail|archives\/list)\//i.test(`${path}/`)) return "mailing-list";
  return null;
}

/** Two spellings of one place count once (discord.com/invite/x is discord.gg/x). */
function linkKey(kind: CommunityKind, url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  if (kind === "discord") return `discord:${path.split("/").at(-1)}`;
  const hash = kind === "matrix" || kind === "gitter" ? url.hash.toLowerCase() : "";
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path.toLowerCase()}${hash}`;
}

/** The chat, forum and mailing-list links in the files, each once (first
 *  file and position wins), in the order found. Pure. */
export function communityLinks(files: Array<{ path: string; text: string }>): CommunityLink[] {
  const seen = new Set<string>();
  const out: CommunityLink[] = [];
  for (const { path, text } of files) {
    const body = text.slice(0, MAX_FILE_CHARS);
    for (const match of body.matchAll(URL_RE)) {
      const raw = match[0].replace(TRAILING, "");
      let url: URL;
      try {
        url = new URL(raw);
      } catch (error) {
        if (error instanceof TypeError) continue; // not a URL after all
        throw error;
      }
      const at = match.index ?? 0;
      const kind = linkKind(url, body.slice(Math.max(0, at - 200), at + raw.length + 200));
      if (!kind) continue;
      const key = linkKey(kind, url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, url: raw, source: path });
    }
  }
  return out;
}

// ---- Discussions -----------------------------------------------------------

const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
const posts = (d: CommunityDiscussion): Post[] => (d.comments?.nodes ?? []).flatMap((c) => [c, ...(c.replies?.nodes ?? [])]);

/** Who acts as a maintainer: GitHub's OWNER/MEMBER/COLLABORATOR anywhere in
 *  the sample, whoever chose the answer to someone else's question, and
 *  `extra` (the profile's merged-by set, which catches private org members). */
function teamOf(discussions: CommunityDiscussion[], extra: Iterable<string>): Set<string> {
  const team = new Set<string>();
  const add = (a: Author) => { if (a?.login && !isBotAuthor(a)) team.add(a.login); };
  for (const login of extra) if (login) team.add(login);
  for (const d of discussions) {
    for (const p of [d, ...posts(d)]) if (isMaintainer(p.authorAssociation)) add(p.author);
    if (d.answerChosenBy?.login !== d.author?.login) add(d.answerChosenBy);
  }
  return team;
}

/** Hours from opening to the first maintainer comment or reply, or null. */
function firstReplyHours(d: CommunityDiscussion, team: Set<string>): number | null {
  const start = Date.parse(d.createdAt);
  const times = posts(d)
    .filter((p) => p.author?.login && team.has(p.author.login) && p.author.login !== d.author?.login)
    .map((p) => Date.parse(p.createdAt)).filter((t) => Number.isFinite(t) && t >= start);
  return times.length ? (Math.min(...times) - start) / 3_600_000 : null;
}

function tally<T extends { url: string }>(items: T[], test: (item: T) => boolean): Tally {
  const hits = items.filter(test);
  return { count: hits.length, of: items.length, examples: hits.slice(0, EXAMPLES).map((x) => x.url) };
}

/** The discussions measured (pure). `discussions` are the sample already
 *  chosen by fetchCommunity; `enabled` false means Discussions are off. */
export function summarizeCommunity(
  repo: string,
  input: { enabled: boolean; total: number; discussions: CommunityDiscussion[]; files: Array<{ path: string; text: string }> },
  now = new Date(),
  extraMaintainers: Iterable<string> = [],
): RepoCommunity {
  const links = communityLinks(input.files);
  const base = { version: 1 as const, repo, computedAt: now.toISOString(), links };
  if (!input.enabled) return { ...base, discussions: null };

  const all = input.discussions;
  const team = teamOf(all, extraMaintainers);
  const outside = all.filter((d) => !isBotAuthor(d.author) && !team.has(d.author!.login));
  const hours = new Map(outside.map((d) => [d, firstReplyHours(d, team)]));
  const questions = outside.filter((d) => d.category.isAnswerable);

  const categories = new Map<string, Category>();
  for (const d of all) {
    const c = categories.get(d.category.slug)
      ?? { name: d.category.name, url: `https://github.com/${repo}/discussions/categories/${d.category.slug}`, answerable: d.category.isAnswerable, count: 0 };
    categories.set(d.category.slug, { ...c, count: c.count + 1 });
  }
  const created = all.map((d) => d.createdAt).sort();
  return {
    ...base,
    discussions: {
      window: { from: created[0] ?? null, to: created.at(-1) ?? null, discussions: all.length },
      total: input.total,
      outside: outside.length,
      maintainerReply: tally(outside, (d) => hours.get(d) !== null),
      answered: tally(questions, (d) => d.isAnswered === true),
      medianHoursToMaintainerReply: round1(median([...hours.values()].filter((h): h is number => h !== null))),
      categories: [...categories.values()].sort((a, b) => b.count - a.count),
    },
  };
}

// ---- Findings --------------------------------------------------------------

const pct = (t: Tally) => `${Math.round((t.count / t.of) * 100)}%`;
const hoursText = (h: number) => h < 1 ? "under an hour" : h < 48 ? `about ${Math.round(h)} hours` : `about ${Math.round(h / 24)} days`;
const month = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const list = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export const KIND_TEXT: Record<CommunityKind, string> = {
  discord: "Discord server",
  slack: "Slack workspace",
  zulip: "Zulip chat",
  gitter: "Gitter room",
  matrix: "Matrix room",
  discourse: "Discourse forum",
  "mailing-list": "mailing list",
};

/** The signal as sentences. Rates are stated only over MIN_SAMPLE discussions,
 *  the reply time only over MIN_SAMPLE replies. */
export function communityFindings(c: RepoCommunity): Array<{ text: string; examples: string[] }> {
  const out: Array<{ text: string; examples: string[] }> = [];
  const d = c.discussions;
  if (d === null) out.push({ text: "GitHub Discussions are turned off for this repository.", examples: [] });
  else if (d.total === 0) out.push({ text: "GitHub Discussions are on, but nobody has opened one.", examples: [] });
  else if (d.window.discussions === 0) out.push({ text: "GitHub Discussions are on, but no discussion is old enough (a month) to measure.", examples: [] });
  else {
    const [from, to] = [month(d.window.from!), month(d.window.to!)];
    const when = from === to ? `in ${from}` : `between ${from} and ${to}`;
    if (d.maintainerReply.of >= MIN_SAMPLE) {
      out.push({ text: `Of ${d.maintainerReply.of} GitHub Discussions outside contributors opened ${when}, ${d.maintainerReply.count} got a maintainer reply (${pct(d.maintainerReply)}).`, examples: d.maintainerReply.examples });
    }
    if (d.answered.of >= MIN_SAMPLE) {
      const qa = d.categories.filter((x) => x.answerable).map((x) => x.name);
      const where = `${list(qa)} ${qa.length === 1 ? "category" : "categories"}`;
      out.push({ text: `${d.answered.count} of ${d.answered.of} questions (${where}) were marked answered (${pct(d.answered)}).`, examples: d.answered.examples });
    }
    if (d.medianHoursToMaintainerReply !== null && d.maintainerReply.count >= MIN_SAMPLE) {
      out.push({ text: `In Discussions, a maintainer usually first replies within ${hoursText(d.medianHoursToMaintainerReply)}.`, examples: [] });
    }
    if (d.window.discussions >= MIN_SAMPLE) {
      const top = d.categories.slice(0, 3);
      out.push({ text: `The busiest Discussions categories are ${list(top.map((x) => `${x.name} (${x.count})`))}, of ${d.window.discussions} discussions.`, examples: top.map((x) => x.url) });
    }
  }
  for (const kind of COMMUNITY_KINDS) {
    const found = c.links.filter((l) => l.kind === kind);
    if (!found.length) continue;
    const sources = list([...new Set(found.map((l) => l.source))]);
    const what = found.length === 1 ? `a ${KIND_TEXT[kind]}` : `${found.length} ${KIND_TEXT[kind]}s`;
    out.push({ text: `The project links ${what} from ${sources}.`, examples: found.slice(0, EXAMPLES).map((l) => l.url) });
  }
  return out;
}

// ---- Fetch -----------------------------------------------------------------

const DISCUSSION_FIELDS = `
  url createdAt authorAssociation isAnswered
  author { login __typename }
  answerChosenBy { login __typename }
  category { name slug isAnswerable }
  comments(first: 20) { nodes { createdAt authorAssociation author { login __typename }
    replies(first: 5) { nodes { createdAt authorAssociation author { login __typename } } } } }`;

const fileFields = (paths: string[]) =>
  paths.map((f, i) => `f${i}: object(expression: ${JSON.stringify(`HEAD:${f}`)}) { ... on Blob { text } }`).join("\n");

type FileData = Record<string, { text?: string | null } | null | undefined>;
type MainData = {
  repository: (FileData & {
    nameWithOwner: string;
    hasDiscussionsEnabled: boolean;
    discussions: { totalCount: number; nodes: CommunityDiscussion[] };
  }) | null;
};

/** Read and summarize, no cache. `extraMaintainers` are logins to count as
 *  maintainers beyond GitHub's associations (the profile's merged-by set).
 *  Throws InvalidRepoNameError, or RepoCommunityFetchError when GitHub fails
 *  or the repository is missing. */
export async function fetchCommunity(
  client: GitHubClient, owner: string, name: string, now = new Date(), extraMaintainers: Iterable<string> = [],
): Promise<RepoCommunity> {
  const repo = splitRepo(`${owner}/${name}`).join("/");
  const ask = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    let data: T;
    try {
      data = await client.graphql<T>(query, variables);
    } catch (error) {
      throw new RepoCommunityFetchError(repo, error);
    }
    if (!data) throw new RepoCommunityFetchError(repo);
    return data;
  };

  const main = await ask<MainData>(`query RepoCommunity($owner: String!, $name: String!, $n: Int!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner hasDiscussionsEnabled
      discussions(first: $n, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { ${DISCUSSION_FIELDS} } }
      ${fileFields(COMMUNITY_FILES)}
    }
  }`, { owner, name, n: DISCUSSION_PAGE });
  const r = main.repository;
  if (!r) throw new RepoCommunityFetchError(repo);
  const canonical = r.nameWithOwner;

  // The newest discussions at least a month old. Discussion search ignores
  // sort: (it returns relevance order), so the newest-first connection is the
  // way to read "the most recent"; only when a busy repository's first page
  // is all younger than a month does search's created: filter (which does
  // work) fill the window MIN_AGE_DAYS..MAX_AGE_DAYS instead.
  const cutoff = now.getTime() - MIN_AGE_DAYS * 86_400_000;
  const old = (list: CommunityDiscussion[]) => list.filter((d) => typeof d?.url === "string" && Date.parse(d.createdAt) <= cutoff);
  let sample = old(r.discussions.nodes).slice(0, DISCUSSION_SAMPLE);
  if (r.hasDiscussionsEnabled && sample.length < DISCUSSION_SAMPLE && r.discussions.totalCount > r.discussions.nodes.length) {
    const day = (ago: number) => new Date(now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);
    const found = await ask<{ search: { nodes: CommunityDiscussion[] } }>(`query RepoCommunityWindow($q: String!, $n: Int!) {
      search(query: $q, type: DISCUSSION, first: $n) { nodes { ... on Discussion { ${DISCUSSION_FIELDS} } } }
    }`, { q: `repo:${canonical} created:${day(MAX_AGE_DAYS)}..${day(MIN_AGE_DAYS)}`, n: DISCUSSION_SAMPLE });
    const windowed = old(found.search?.nodes ?? []);
    if (windowed.length > sample.length) sample = windowed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const files = new Map(COMMUNITY_FILES.flatMap((path, i) => {
    const text = r[`f${i}`]?.text;
    return text ? [[path, text] as const] : [];
  }));
  // A symlinked guide comes back as its target's path (pydantic's CONTRIBUTING.md); read the target once.
  const links = new Map([...files].flatMap(([path, text]) => {
    const target = symlinkTarget(path, text);
    return target ? [[path, target] as const] : [];
  }));
  if (links.size) {
    const targets = [...new Set(links.values())];
    const [o, n] = canonical.split("/");
    const read = await ask<{ repository: FileData | null }>(`query RepoCommunityFiles($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { ${fileFields(targets)} }
    }`, { owner: o, name: n });
    if (!read.repository) throw new RepoCommunityFetchError(repo);
    for (const [path, target] of links) {
      files.delete(path);
      const text = read.repository[`f${targets.indexOf(target)}`]?.text;
      if (text && !files.has(target)) files.set(target, text);
    }
  }

  return summarizeCommunity(canonical, {
    enabled: r.hasDiscussionsEnabled,
    total: r.discussions.totalCount,
    discussions: sample,
    files: [...files].map(([path, text]) => ({ path, text })),
  }, now, extraMaintainers);
}
