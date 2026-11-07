// The repository's profile: the unwritten rules a newcomer can't read in
// CONTRIBUTING.md, measured from the project's own recently opened pull
// requests. What gets merged versus closed (and why), what reviewers keep
// asking for, how fast maintainers answer, and the house conventions.
//
// Measured, never guessed: no model writes a claim. Sorting comments into
// close reasons and review requests is fixed patterns, and every finding
// carries its count, its sample size and up to EXAMPLES links to the PRs
// behind it. Repository-level only: no logins, no per-person figures.
// Silence is a finding too: a repository that takes no PRs on GitHub, PRs
// nobody answered, or no outside merge in the window are said outright, at
// any sample size, so an empty profile never reads as a quiet one.
//
// GitHub only for now. Chat (Discord, Slack) needs a bot the maintainers
// invite themselves; scraping it is against those services' terms.

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { repos } from "./db/schema";
import type { GitHubClient } from "./gh";
import { aiStatementIn, fetchAiPolicy, splitRepo, type RepoAiPolicy, type RepoAiReading } from "./ai-policy";
import { fetchWanted, wantedFindings, type RepoWanted } from "./repo-wanted";
import { communityFindings, fetchCommunity, type RepoCommunity } from "./repo-community";
import { isMaintainer, median } from "./recs/health";
import { changelogLocation, isBotAuthor, TEST_PATH, TITLE_PATTERNS, titleConvention, type TitleConvention } from "./maintainer-prefs";

/** PRs read per repository: the newest opened in each slice of the cohort window. */
export const PROFILE_SAMPLE = 100;
/** A profile is read again after this long. */
export const PROFILE_TTL_MS = 24 * 60 * 60_000;
/** Fewest PRs (or measurements) a comparison or statistic needs before it is stated. */
export const MIN_SAMPLE = 5;
/** A review request is stated once it recurs on this many PRs: one reviewer's
 *  one-off remark is not a norm. */
export const MIN_REPEATS = 3;
/** Maintainer requests quoted on the profile, one per outside PR. */
export const MAX_VOICES = 6;
/** Example PRs kept per finding. */
export const EXAMPLES = 3;

type Author = { login: string; __typename?: string } | null;
type Comment = { createdAt: string; body: string; authorAssociation: string; author: Author };

export type ProfilePr = {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedBy: Author;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  authorAssociation: string;
  author: Author;
  labels: { nodes: Array<{ name: string }> } | null;
  closingIssuesReferences: { totalCount: number } | null;
  files: { nodes: Array<{ path: string }> } | null;
  commits: { nodes: Array<{ commit: { message: string } }> } | null;
  /** totalCount tells whether `nodes` is all of them (an unanswered PR must be seen whole). */
  reviews: { totalCount?: number; nodes: Array<Comment & { comments: { nodes: Array<{ body: string }> } | null }> } | null;
  comments: { totalCount?: number; nodes: Comment[] } | null;
  /** The ClosedEvent's actor: who closed it. */
  timelineItems: { nodes: Array<{ actor?: Author }> } | null;
};

export const CLOSE_REASONS = [
  "not_assigned", "duplicate", "in_progress", "discuss_first", "out_of_scope", "deprecated", "elsewhere", "stale", "ai_generated",
  "failing_checks", "author_withdrew_after_feedback", "author_withdrew", "unexplained",
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const REVIEW_ASKS = ["tests", "changelog", "docs", "style", "typing", "compatibility", "rebase", "split", "benchmark"] as const;
export type ReviewAsk = (typeof REVIEW_ASKS)[number];

/** What an outside PR changes, from its paths: newcomers' docs fixes and
 *  translations often fare differently from code. */
export const PR_TYPES = ["translation", "docs", "tests", "code"] as const;
export type PrType = (typeof PR_TYPES)[number];

/** A count over a sample, with links to the PRs behind it. */
export type Tally = { count: number; of: number; examples: string[] };

/** Whether the repository takes pull requests on GitHub at all. */
export type RepoStatus = {
  pullRequestsEnabled: boolean;
  archived: boolean;
  mirror: boolean;
  /** A Codeberg, GitLab or SourceHut address from the homepage (or the mirror's source), else null. */
  elsewhere: string | null;
};

/** Version 1 profiles (stored before the optional fields existed) lack them; readers tolerate that. */
export type RepoProfile = {
  version: 1 | 2;
  repo: string;
  computedAt: string;
  /** Creation dates of the PRs read, and how many. minDays–maxDays ago is the
   *  window searched (wider for quiet projects); `opened` is how many PRs
   *  GitHub counts in it, of which `prs` were read. */
  window: { from: string | null; to: string | null; prs: number; minDays?: number; maxDays?: number; opened?: number };
  status?: RepoStatus;
  /** People seen acting as maintainers (see maintainersOf); a count only. */
  maintainers: number;
  /** PRs from people outside the maintainer team (bots left out). */
  outside: {
    merged: Tally;
    closed: number;
    /** Still open: at least COHORT_MIN_AGE_DAYS old by construction. */
    open: Tally;
    medianLinesMerged: number | null;
    medianLinesClosed: number | null;
    testsMerged: Tally;
    testsClosed: Tally;
    linkedMerged: Tally;
    linkedClosed: Tally;
    medianDaysToMerge: number | null;
    /** No maintainer comment or review, not merged, not closed by a maintainer. */
    unanswered?: Tally;
    /** Per PR type: how many of that type were merged, of how many opened. */
    byType?: Array<{ type: PrType } & Tally>;
  };
  /** Read only when no outside PR in the window was merged: the latest outside
   *  merge among the `checked` most recently updated merged PRs (at null: none). */
  lastOutsideMerge?: { at: string | null; url: string | null; checked: number };
  /** Why outside PRs were closed without merging, most common first. */
  closeReasons: Array<{ reason: CloseReason } & Tally>;
  /** What maintainers asked for in review, over PRs that got review text. */
  reviewAsks: Array<{ ask: ReviewAsk; quotes?: Array<{ text: string; url: string }> } & Tally>;
  /** What maintainers asked outside contributors for, verbatim, any topic (MAX_VOICES, one per PR). */
  outsideAsks?: Array<{ text: string; url: string }>;
  /** Null below MIN_SAMPLE responses. */
  medianFirstResponseHours: number | null;
  /** Hours to the first maintainer response on outside PRs that got one: n
   *  measurements, and quartiles once n reaches MIN_SAMPLE. */
  responseHours?: { n: number; q1: number | null; median: number | null; q3: number | null };
  /** From the contributing guides, AI policy files, PR templates and agent
   *  instruction files (lib/ai-policy.ts); null when they could not be read. */
  aiPolicy?: (RepoAiPolicy & Partial<Pick<RepoAiReading, "agentFiles" | "agentDirectives">>) | null;
  /** What maintainers said about AI in review, which is not the written policy. */
  reviewAiStatements?: Array<{ stance: RepoAiPolicy["stance"]; excerpt: string; url: string }>;
  /** lib/repo-wanted.ts and lib/repo-community.ts; null when they could not be read. */
  wanted?: RepoWanted | null;
  community?: RepoCommunity | null;
  /** Each needs MIN_SAMPLE merged human PRs (`merged`). The title style is
   *  measured on merged outside PRs when there are MIN_SAMPLE of them. */
  conventions: {
    title: TitleConvention;
    changelogPath: string | null;
    signOffShare: number | null;
    merged?: number;
    titleTally?: Tally | null;
    titleFrom?: "outside" | "all";
    changelogTally?: Tally | null;
  };
};

export class RepoProfileFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s recent pull requests.`, { cause });
    this.name = "RepoProfileFetchError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(repo: string) {
    super(`${repo} was not found on GitHub.`);
    this.name = "RepoNotFoundError";
  }
}

type PatternReason = Exclude<CloseReason, "author_withdrew" | "author_withdrew_after_feedback" | "unexplained">;
// Close reasons, matched against what maintainers (or a stale bot) wrote last.
// Order matters: the first match wins.
const CLOSE_PATTERNS: Array<[PatternReason, RegExp]> = [
  // pydantic's bot: "You do not have permission to open a PR without being assigned to the issue".
  ["not_assigned", /(without being assigned|not assigned to (the|this) issue|must be assigned|bypass(ing)? (the )?issue assignment|assign(ed)? (yourself|to the issue) (first|before)|claim the issue first)/i],
  ["ai_generated", /\b(ai[- ]generated|llm[- ]generated|generated (by|with) (an? )?(ai|llm|chatgpt|copilot|claude)|chatgpt|ai slop|slop)\b/i],
  // pyjanitor #1743: "i'm already working on this".
  ["in_progress", /\b(already (been )?working on (this|it|that)|already (being worked on|in progress)|(i|we) (already )?have (a|an open) (pr|fix|branch) for (this|it))\b/i],
  ["duplicate", /\b(duplicate|dupe of|already (been )?(fixed|addressed|done|implemented)|superseded by|in favou?r of #?\d+|closing in favou?r)\b/i],
  ["discuss_first", /\b(open an issue first|discuss(ed|ion)? (this )?(first|before)|before (opening|submitting|sending) a (pr|pull request)|needs? (an? )?(issue|discussion|design|proposal)|not (been )?(agreed|discussed))\b/i],
  // pyjanitor #1714: "redirect the PR to pandas-flavor", "move this into the pandas flavor repo".
  ["elsewhere", /\b(redirect(ed)? (the |this )?(pr |change |pull request )?to|move (this|it|the (pr|change)) (in)?to (the )?[\w .-]{1,40}? (repo|repository|project)|belongs (upstream|in [\w.-]+ (repo|repository|project|instead))|(should|would) (go|live|be (made|fixed|done)) upstream|(fix|change|report|submit|send|open|make) (it|this|the (fix|change|pr)) upstream)\b/i],
  // pyjanitor #1722: "this function is earmarked for deprecation".
  ["deprecated", /\b((earmarked|slated|planned|scheduled|marked|up) for (deprecation|removal)|(is|are) (being )?deprecated|(will|going to) be (deprecated|removed)|on (its|their) way out)\b/i],
  ["out_of_scope", /\b(out of scope|won'?t fix|wontfix|not planned|not something we|we (don'?t|do not) (want|plan|intend)|not (a )?good fit|no plans to|decline)\b/i],
  ["stale", /\b(stale|inactiv(e|ity)|no (recent )?(activity|response)|abandoned|closing (this )?(due to|because of) (lack|inactivity))\b/i],
  ["failing_checks", /\b(tests? (are )?fail(ing|s)?|ci (is )?(failing|red|broken)|does(n'?t| not) pass|checks? fail)\b/i],
];
const CLOSE_LABELS: Array<[CloseReason, RegExp]> = [
  ["duplicate", /duplicate/i], ["out_of_scope", /wontfix|won't fix|invalid|not planned/i], ["stale", /stale/i],
];

const REVIEW_PATTERNS: Array<[ReviewAsk, RegExp]> = [
  ["tests", /\b(add (a |some )?tests?|test (case|coverage)|regression test|missing tests?|unit tests?|needs? (a )?tests?)\b/i],
  ["changelog", /\b(changelog|whats ?new|release notes?|news (entry|fragment)|towncrier|changeset)\b/i],
  ["docs", /\b(docstring|documentation|docs? (entry|page|update)|update the docs?)\b/i],
  ["style", /\b(pre-commit|linter?|lint(ing)?|formatt(ing|er)|black|ruff|flake8|prettier|eslint|code style)\b/i],
  ["typing", /\b(type (hints?|annotations?)|mypy|pyright|typing)\b/i],
  ["compatibility", /\b(backwards?[- ]compat(ible|ibility)?|deprecat(e|ion)|public api|breaking change)\b/i],
  ["rebase", /\b(rebase|merge conflicts?|resolve (the )?conflicts?)\b/i],
  ["split", /\b(split (this|it) (up|into)|smaller prs?|separate (pr|pull request)|one change per)\b/i],
  ["benchmark", /\b(benchmarks?|asv|perf(ormance)? regression)\b/i],
];
/** A review keyword counts only when its sentence asks for something: "please
 *  add a changelog entry" does, "credited you in the changelog" and "I should
 *  have spent more time on the documentation" (pyjanitor) don't. */
const REQUEST = /\b(please|pls|could you|can you|would you|kindly|needs? to|should(?! have)|must|add|update|missing|don'?t forget)\b/i;
/** How far either side of the keyword the request may be, within its sentence. */
const REQUEST_REACH = 60;
const SENTENCE_END = /[.!?](?:\s|$)|\n/;

/** True when `re` matches somewhere in `text` that is framed as a request. Exported for tests. */
export function askedFor(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - REQUEST_REACH), start).split(SENTENCE_END).at(-1) ?? "";
    const after = text.slice(start + m[0].length, start + m[0].length + REQUEST_REACH).split(SENTENCE_END)[0];
    if (REQUEST.test(before + m[0] + after)) return true;
  }
  return false;
}

/** The maintainer's own sentence that asks for it, verbatim (code blocks and
 *  quoted replies left out), or null when no readable sentence asks. Exported for tests. */
export function quoteFor(text: string, re: RegExp): string | null {
  return sentencesOf(text).find((s) => askedFor(s, re)) ?? null;
}

/** Readable sentences of a comment: code blocks and quoted replies left out, 20–220 characters. */
function sentencesOf(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, " ").split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
  return prose.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 20 && s.length <= 220);
}

/** Asking, on any topic: stricter than REQUEST, whose "should"/"add" also
 *  describe ("this should work now"). */
const ASKING = /\b(please|pls|could you|can you|would you|kindly|don'?t forget|(this|it|that) needs? to)\b/i;
/** A sentence cut off where code or a link follows ("could you run it through", "with an assert like:"). */
const DANGLING = /(:|\b(through|with|like|at|to|in|on|of|for|the|a|an|following|below))$/i;

/** The first sentence in a comment that asks the contributor for something, verbatim, or null. Exported for tests. */
export function requestIn(text: string): string | null {
  return sentencesOf(text).find((s) => ASKING.test(s) && !DANGLING.test(s.replace(/[\s.!?]+$/, ""))) ?? null;
}

const TRANSLATION_PATH =/(^|\/)(locales?|translations?|i18n|l10n)\/|\.pot?$/i;
const DOCS_PATH = /(^|\/)docs?\/|\.(md|rst|adoc)$|(^|\/)(readme|contributing|authors)[^/]*$|(^|\/)mkdocs\.ya?ml$/i;

/** A title that declares a docs change: "docs: …", "docs(api): …", "[DOC] …", "DOC: …". */
const DOCS_TITLE = /^(\[docs?\]|docs?(\([^)]{1,40}\))?!?:)/i;

/** What the PR changes, from its paths (changelog entries don't count either
 *  way); null when its files are unknown. A docstring fix touches only code
 *  files, so a title that says docs makes it docs, unless it touches tests
 *  (pyjanitor's "[DOC]" PRs edit janitor/functions/*.py). Exported for tests. */
export function prType(pr: Pick<ProfilePr, "files"> & { title?: string }): PrType | null {
  const all = (pr.files?.nodes ?? []).map((f) => f.path);
  if (!all.length) return null;
  const rest = all.filter((p) => changelogLocation(p) === null);
  if (rest.every((p) => TRANSLATION_PATH.test(p)) && rest.length) return "translation";
  if (rest.every((p) => DOCS_PATH.test(p) || TRANSLATION_PATH.test(p))) return "docs";
  if (rest.every((p) => TEST_PATH.test(p))) return "tests";
  if (DOCS_TITLE.test(pr.title?.trim() ?? "") && !rest.some((p) => TEST_PATH.test(p))) return "docs";
  return "code";
}

const lines = (pr: ProfilePr) => pr.additions + pr.deletions;
const paths = (pr: ProfilePr) => (pr.files?.nodes ?? []).map((f) => f.path);
const touchesTests = (pr: ProfilePr) => paths(pr).some((p) => TEST_PATH.test(p));
const linked = (pr: ProfilePr) => (pr.closingIssuesReferences?.totalCount ?? 0) > 0;
const round = (value: number | null, places = 0) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places;
/** A comment's own words: quoted lines ("> ...") are someone else's. */
const ownWords = (body: string) => body.replace(/^\s*>.*$/gm, "");

function tally(prs: ProfilePr[], test: (pr: ProfilePr) => boolean): Tally {
  const hits = prs.filter(test);
  return { count: hits.length, of: prs.length, examples: hits.slice(0, EXAMPLES).map((pr) => pr.url) };
}

/** The q-quantile of sorted values, interpolating between neighbours. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

/** Who acts as a maintainer, from what they did in the sample: merged a PR,
 *  or closed someone else's, plus GitHub's own OWNER/MEMBER/COLLABORATOR.
 *  The association alone misses maintainers whose org membership is private
 *  (they show as CONTRIBUTOR). Exported for tests. */
export function maintainersOf(prs: ProfilePr[]): Set<string> {
  const team = new Set<string>();
  const add = (a: Author | undefined) => { if (a?.login && !isBotAuthor(a)) team.add(a.login); };
  for (const pr of prs) {
    add(pr.mergedBy);
    const closer = pr.timelineItems?.nodes.at(-1)?.actor;
    if (pr.state === "CLOSED" && closer?.login !== pr.author?.login) add(closer);
    if (isMaintainer(pr.authorAssociation)) add(pr.author);
    for (const c of [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])]) if (isMaintainer(c.authorAssociation)) add(c.author);
  }
  return team;
}

const byTeam = (team: Set<string>, pr: ProfilePr) => (c: Comment) =>
  Boolean(c.author?.login && team.has(c.author.login) && c.author.login !== pr.author?.login);

/** What maintainers wrote on the PR: reviews, their inline comments, and conversation. */
function maintainerText(pr: ProfilePr, team: Set<string>): string[] {
  const mine = byTeam(team, pr);
  return [
    ...(pr.reviews?.nodes ?? []).filter(mine).flatMap((r) => [r.body, ...(r.comments?.nodes ?? []).map((c) => c.body)]),
    ...(pr.comments?.nodes ?? []).filter(mine).map((c) => c.body),
  ].map((text) => ownWords(text ?? "")).filter((text) => text.trim());
}

/** Hours from opening to the first maintainer review or comment, or null. */
function firstResponseHours(pr: ProfilePr, team: Set<string>): number | null {
  const start = Date.parse(pr.createdAt);
  const times = [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].filter(byTeam(team, pr))
    .map((c) => Date.parse(c.createdAt)).filter((t) => Number.isFinite(t) && t >= start);
  return times.length ? (Math.min(...times) - start) / 3_600_000 : null;
}

/** No maintainer said anything and nobody merged or closed it for a stated
 *  reason. Closing is an answer, by a maintainer or by a project's bot
 *  (pydantic's "assign yourself first"); a stale bot's close is not. A PR
 *  whose comments or reviews weren't all read counts as answered: unknown is
 *  not silence. */
function unanswered(pr: ProfilePr, team: Set<string>): boolean {
  if (pr.state === "MERGED") return false;
  const whole = (c: { totalCount?: number; nodes: unknown[] } | null) => (c?.totalCount ?? 0) <= (c?.nodes.length ?? 0);
  if (!whole(pr.comments) || !whole(pr.reviews)) return false;
  if ([...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].some(byTeam(team, pr))) return false;
  const closer = pr.timelineItems?.nodes.at(-1)?.actor?.login;
  if (pr.state === "CLOSED" && closer && closer !== pr.author?.login) return closeReason(pr, team) === "stale";
  return true;
}

/** Why a closed PR was closed: its labels, then the last maintainer or bot
 *  comments; if its author closed it, their own last comment, then whether a
 *  maintainer had commented before they did. Exported for tests. */
export function closeReason(pr: ProfilePr, team: Set<string>): CloseReason {
  for (const [reason, re] of CLOSE_LABELS) if ((pr.labels?.nodes ?? []).some((l) => re.test(l.name))) return reason;
  const comments = pr.comments?.nodes ?? [];
  const notes = comments.filter((c) => byTeam(team, pr)(c) || isBotAuthor(c.author)).map((c) => ownWords(c.body));
  for (const note of notes.reverse()) {
    for (const [reason, re] of CLOSE_PATTERNS) if (re.test(note)) return reason;
  }
  const author = pr.author?.login;
  const closer = pr.timelineItems?.nodes.at(-1)?.actor?.login;
  if (!closer || closer !== author) return "unexplained";
  // The author's own last word often says why (pyjanitor #1714: "the
  // maintainers asked that the change be redirected to pandas-flavor"). Not
  // the AI pattern: an author mentioning ChatGPT is not being called out.
  const last = comments.filter((c) => c.author?.login === author).at(-1);
  if (last) {
    for (const [reason, re] of CLOSE_PATTERNS) if (reason !== "ai_generated" && re.test(ownWords(last.body))) return reason;
  }
  const closedAt = Date.parse(pr.closedAt ?? "");
  const feedback = [...(pr.reviews?.nodes ?? []), ...comments].filter(byTeam(team, pr))
    .some((c) => !Number.isFinite(closedAt) || Date.parse(c.createdAt) <= closedAt);
  return feedback ? "author_withdrew_after_feedback" : "author_withdrew";
}

/** The window the PRs were read from, in days ago, and how many PRs GitHub counted in it. */
export type ProfileWindow = { minDays: number; maxDays: number; opened?: number };

/** The profile from the PRs (pure): every PR opened in the window, newest
 *  first, open ones included so slow outcomes count too. */
export function summarizeProfile(repo: string, prs: ProfilePr[], now = new Date(), window: ProfileWindow = COHORT_WINDOWS[0]): RepoProfile {
  const team = maintainersOf(prs);
  const human = prs.filter((pr) => !isBotAuthor(pr.author));
  const outside = human.filter((pr) => !pr.author?.login || !team.has(pr.author.login));
  const merged = outside.filter((pr) => pr.state === "MERGED");
  const closed = outside.filter((pr) => pr.state === "CLOSED");

  const reasons = new Map<CloseReason, ProfilePr[]>();
  for (const pr of closed) {
    const reason = closeReason(pr, team);
    reasons.set(reason, [...(reasons.get(reason) ?? []), pr]);
  }

  const reviewed = human.filter((pr) => maintainerText(pr, team).length > 0);
  const asks = REVIEW_ASKS.map((ask) => {
    const re = REVIEW_PATTERNS.find(([a]) => a === ask)![1];
    // The maintainers' own words: one sentence per PR, outside contributors' PRs first.
    const quotes = [...reviewed].sort((a, b) => Number(outside.includes(b)) - Number(outside.includes(a))).flatMap((pr) => {
      const said = maintainerText(pr, team).map((t) => quoteFor(t, re)).find((q) => q !== null);
      return said ? [{ text: said, url: pr.url }] : [];
    }).slice(0, 2);
    return { ask, ...tally(reviewed, (pr) => maintainerText(pr, team).some((t) => askedFor(t, re))), quotes };
  }).filter((a) => a.count > 0).sort((a, b) => b.count - a.count);
  // What maintainers asked outside contributors for, on any topic: one
  // sentence per PR, verbatim, newest PRs first, no repeats.
  // Requests sharing most of their words are one request (pandas: "Once it reports LGTM, please leave a comment…" twice).
  const words = (q: string) => new Set(q.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const sameAsk = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length / new Set([...a, ...b]).size >= 0.6;
  const seenAsks: Array<Set<string>> = [];
  const outsideAsks = [...outside].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).flatMap((pr) => {
    const said = maintainerText(pr, team).map(requestIn).find((q) => q !== null && !seenAsks.some((s) => sameAsk(s, words(q))));
    if (!said) return [];
    seenAsks.push(words(said));
    return [{ text: said, url: pr.url }];
  }).slice(0, MAX_VOICES);

  // Conventions need MIN_SAMPLE merged human PRs: one release PR is not a habit (earthpy).
  const humanMerged = human.filter((pr) => pr.state === "MERGED");
  const enough = humanMerged.length >= MIN_SAMPLE;
  const locations = new Map<string, ProfilePr[]>();
  for (const pr of humanMerged) {
    for (const l of new Set(paths(pr).map(changelogLocation).filter((x): x is string => x !== null))) locations.set(l, [...(locations.get(l) ?? []), pr]);
  }
  const [topLocation, locationPrs] = [...locations.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, []];
  const changelogTally = enough && topLocation && locationPrs.length >= MIN_REPEATS ? tally(humanMerged, (pr) => locationPrs.includes(pr)) : null;
  // Titles as newcomers must write them: merged outside PRs (pyjanitor's
  // template asks them for [DOC]/[ENH] tags that maintainers skip).
  const titleFrom = merged.length >= MIN_SAMPLE ? "outside" : "all";
  const titled = titleFrom === "outside" ? merged : humanMerged;
  const title = titled.length >= MIN_SAMPLE ? titleConvention(titled.map((pr) => pr.title)) : "none";
  const signedOff = humanMerged.filter((pr) => (pr.commits?.nodes ?? []).some((c) => /^Signed-off-by: .+<[^>]+>/m.test(c.commit.message))).length;
  // What a newcomer waits for: outside PRs only.
  const responses = outside.map((pr) => firstResponseHours(pr, team)).filter((h): h is number => h !== null).sort((a, b) => a - b);
  const timed = responses.length >= MIN_SAMPLE;
  const days = merged.map((pr) => pr.mergedAt ? (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 86_400_000 : NaN).filter(Number.isFinite);
  const created = prs.map((pr) => pr.createdAt).sort();
  const types = outside.map((pr) => [pr, prType(pr)] as const);
  // pyjanitor #1714: "Totally ok to use your agents". Said in review, so
  // reported as that, never as the project's policy.
  const reviewAiStatements = human.flatMap((pr) => maintainerText(pr, team).flatMap((text) => {
    const found = aiStatementIn(text);
    return found && found.stance !== "unknown" ? [{ stance: found.stance, excerpt: found.excerpt.slice(0, 200), url: pr.url }] : [];
  })).slice(0, EXAMPLES);

  return {
    version: 2,
    reviewAiStatements,
    repo,
    computedAt: now.toISOString(),
    window: { from: created[0] ?? null, to: created.at(-1) ?? null, prs: prs.length, minDays: window.minDays, maxDays: window.maxDays, opened: Math.max(window.opened ?? 0, prs.length) },
    maintainers: team.size,
    outside: {
      merged: tally(outside, (pr) => pr.state === "MERGED"),
      closed: closed.length,
      open: tally(outside, (pr) => pr.state === "OPEN"),
      medianLinesMerged: round(median(merged.map(lines))),
      medianLinesClosed: round(median(closed.map(lines))),
      testsMerged: tally(merged, touchesTests),
      testsClosed: tally(closed, touchesTests),
      linkedMerged: tally(merged, linked),
      linkedClosed: tally(closed, linked),
      medianDaysToMerge: round(median(days), 1),
      unanswered: tally(outside, (pr) => unanswered(pr, team)),
      byType: PR_TYPES.map((type) => ({ type, ...tally(types.filter(([, t]) => t === type).map(([pr]) => pr), (pr) => pr.state === "MERGED") }))
        .filter((t) => t.of > 0),
    },
    closeReasons: [...reasons.entries()]
      .map(([reason, list]) => ({ reason, count: list.length, of: closed.length, examples: list.slice(0, EXAMPLES).map((pr) => pr.url) }))
      .sort((a, b) => b.count - a.count),
    reviewAsks: asks,
    outsideAsks,
    medianFirstResponseHours: timed ? round(median(responses), 1) : null,
    responseHours: {
      n: responses.length,
      q1: timed ? round(quantile(responses, 0.25), 1) : null,
      median: timed ? round(median(responses), 1) : null,
      q3: timed ? round(quantile(responses, 0.75), 1) : null,
    },
    conventions: {
      title,
      changelogPath: changelogTally ? topLocation : null,
      signOffShare: enough ? round(signedOff / humanMerged.length, 2) : null,
      merged: humanMerged.length,
      titleTally: title === "none" ? null : tally(titled, (pr) => TITLE_PATTERNS[title].test(pr.title.trim())),
      titleFrom,
      changelogTally,
    },
  };
}

export const CLOSE_REASON_TEXT: Record<CloseReason, string> = {
  not_assigned: "opened without being assigned to the issue first",
  duplicate: "a duplicate, or already fixed",
  in_progress: "a maintainer was already working on it",
  discuss_first: "maintainers wanted an issue or discussion first",
  out_of_scope: "out of scope or not wanted",
  deprecated: "the code it changed is being deprecated",
  elsewhere: "maintainers asked for the change in another project",
  stale: "went stale",
  ai_generated: "called out as AI-generated",
  failing_checks: "tests or CI failing",
  author_withdrew_after_feedback: "closed by its own author after a maintainer's comment or review",
  author_withdrew: "closed by its own author, with no maintainer comment",
  unexplained: "closed with no stated reason",
};

export const REVIEW_ASK_TEXT: Record<ReviewAsk, string> = {
  tests: "add or fix tests",
  changelog: "add a changelog entry",
  docs: "update the documentation or docstrings",
  style: "fix formatting or linting (run pre-commit)",
  typing: "add or fix type annotations",
  compatibility: "keep backwards compatibility or add a deprecation",
  rebase: "rebase or resolve conflicts",
  split: "split the change into smaller PRs",
  benchmark: "show benchmarks or check performance",
};

const PR_TYPE_TEXT: Record<PrType, string> = {
  translation: "translations", docs: "docs-only", tests: "tests-only", code: "code changes",
};

/** What to do before writing code, when the project closes PRs for skipping
 *  it: ask to be assigned, or agree the approach first. The comment is a draft
 *  for the contributor to finish and post themselves; opensrcer never posts. */
export type EngagementAdvice = { reason: "not_assigned" | "discuss_first"; count: number; of: number; comment: string };

const ADVICE_COMMENTS: Record<EngagementAdvice["reason"], string> = {
  not_assigned: "Hi! I'd like to work on this. My plan: <one or two sentences on the fix>, with a test that reproduces the problem. Could you assign it to me?",
  discuss_first: "Hi! Before opening a pull request I'd like to check the approach: <one or two sentences on the fix>. Does that sound right, or would you prefer a different direction?",
};

/** The advice, when one of those close reasons recurs (MIN_REPEATS); assignment first. */
export function engagementAdvice(p: RepoProfile): EngagementAdvice | null {
  for (const reason of ["not_assigned", "discuss_first"] as const) {
    const r = p.closeReasons.find((x) => x.reason === reason);
    if (r && r.count >= MIN_REPEATS) return { reason, count: r.count, of: r.of, comment: ADVICE_COMMENTS[reason] };
  }
  return null;
}

/** One readable finding with what backs it. */
export type Finding = { section: "start" | "wanted" | "outcomes" | "closed" | "review" | "pace" | "community" | "conventions"; text: string; examples: string[] };

const pct = (t: Tally) => `${Math.round((t.count / t.of) * 100)}%`;
const hoursText = (h: number) => h < 1 ? "an hour" : h < 48 ? `about ${Math.round(h)} hours` : `about ${Math.round(h / 24)} days`;
const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "1–4 months ago": a window in days ago, in words. */
export function windowText(minDays: number, maxDays: number): string {
  const months = (d: number) => Math.max(1, Math.round(d / 30.44));
  return `${months(minDays)}–${months(maxDays)} months ago`;
}

/** The profile as sentences, for the page and the harness's agent context.
 *  A comparison is stated only when both sides have MIN_SAMPLE PRs; an
 *  absence (no PRs, no replies, no outside merges) is stated at any size. */
export function profileFindings(p: RepoProfile): Finding[] {
  const out: Finding[] = [];
  const when = windowText(p.window.minDays ?? COHORT_MIN_AGE_DAYS, p.window.maxDays ?? COHORT_MAX_AGE_DAYS);
  const s = p.status;
  if (s && (!s.pullRequestsEnabled || s.archived || s.mirror)) {
    const what = [!s.pullRequestsEnabled && "doesn't accept pull requests on GitHub", s.archived && "is archived (read-only)", s.mirror && "is a mirror"]
      .filter(Boolean).join(" and ");
    out.push({ section: "start", text: `This repository ${what}${s.elsewhere ? `; it points to ${s.elsewhere} instead` : ""}.`, examples: [] });
  }
  if (p.window.prs === 0) {
    out.push({ section: "start", text: `No pull requests opened ${when} were found, so nothing here is measured from this project's PRs.`, examples: [] });
  }
  const ai = p.aiPolicy;
  const quote = (x: RepoAiPolicy) => x.source ? ` (${x.source}${x.evidence ? `: "${x.evidence.slice(0, 200)}"` : ""})` : "";
  if (ai === null) out.push({ section: "start", text: "The project's AI policy could not be read: check its contributing guide before using AI.", examples: [] });
  else if (ai?.stance === "banned") out.push({ section: "start", text: `This project does not accept AI-generated contributions${quote(ai)}.`, examples: [] });
  else if (ai?.stance === "disclosure-required") out.push({ section: "start", text: `The project asks contributors to disclose AI assistance${quote(ai)}.`, examples: [] });
  else if (ai?.stance === "allowed") out.push({ section: "start", text: `AI-assisted contributions are welcome${quote(ai)}.`, examples: [] });
  else if (ai?.stance === "unknown") out.push({ section: "start", text: "No AI policy in its contributing guide or PR template: disclose AI assistance anyway.", examples: [] });
  for (const f of (ai?.agentFiles ?? []).slice(0, 3)) {
    out.push({ section: "start", text: `The project has instructions for AI agents in ${f.path}: read and follow them before changing code.`, examples: [] });
  }
  // Shown to the person, never followed silently (movingpandas: "add 🤖🤖🤖 to the PR title").
  for (const d of (ai?.agentDirectives ?? []).slice(0, 2)) {
    out.push({ section: "start", text: `${d.path} speaks to AI agents directly: "${d.text}" This is shown to you rather than followed.`, examples: [] });
  }
  const said = (p.reviewAiStatements ?? [])[0];
  if (said && ai?.stance !== "banned") {
    out.push({ section: "start", text: `A maintainer said in review, which is not the written policy: "${said.excerpt}"`, examples: [said.url] });
  }
  if (p.wanted) out.push(...wantedFindings(p.wanted).map((f) => ({ section: "wanted" as const, ...f })));
  const o = p.outside;
  if (p.window.prs > 0 && o.merged.of === 0) {
    out.push({ section: "outcomes", text: `${p.window.prs} of ${p.window.prs} PRs opened ${when} came from maintainers or bots; none from outside contributors.`, examples: [] });
  }
  if (o.merged.of >= MIN_SAMPLE) {
    const open = o.open.count === 0 ? "" : ` and ${o.open.count} ${o.open.count === 1 ? "is" : "are"} still open`;
    const opened = p.window.opened ?? p.window.prs;
    const sampled = opened > p.window.prs ? ` They come from the ${p.window.prs} PRs read of the ${opened} opened then.` : "";
    out.push({ section: "outcomes", text: `Of ${o.merged.of} PRs outside contributors opened ${when}, ${o.merged.count} were merged (${pct(o.merged)}), ${o.closed} closed${open}.${sampled}`, examples: o.merged.examples });
    if (o.open.count >= MIN_SAMPLE) {
      out.push({ section: "pace", text: `${pct(o.open)} of outside PRs are still open a month or more after they were opened.`, examples: o.open.examples });
    }
  }
  const types = (o.byType ?? []).filter((t) => t.of >= MIN_SAMPLE);
  if (types.some((t) => t.type !== "code") || types.length > 1) {
    const list = types.map((t) => `${PR_TYPE_TEXT[t.type]} ${t.count} of ${t.of} (${pct(t)})`).join(", ");
    out.push({ section: "outcomes", text: `By what they change, outside PRs were merged: ${list}.`, examples: types.find((t) => t.type !== "code")?.examples ?? types[0].examples });
  }
  // Silence, at any sample size: a newcomer's PR that nobody answered.
  if (o.unanswered && o.unanswered.count > 0) {
    out.push({ section: "pace", text: `${o.unanswered.count} of ${o.unanswered.of} outside PRs opened ${when} got no comment or review from a maintainer.`, examples: o.unanswered.examples });
  }
  const last = p.lastOutsideMerge;
  if (last?.at) out.push({ section: "outcomes", text: `No outside PR opened ${when} was merged; the last outside contributor's PR was merged on ${dateText(last.at)}.`, examples: last.url ? [last.url] : [] });
  else if (last && last.checked > 0) out.push({ section: "outcomes", text: `No outside PR opened ${when} was merged, nor any of the ${last.checked} most recently updated merged PRs.`, examples: [] });
  else if (last) out.push({ section: "outcomes", text: "GitHub shows no merged pull requests in this repository.", examples: [] });
  const both = o.merged.count >= MIN_SAMPLE && o.closed >= MIN_SAMPLE;
  if (both && o.medianLinesMerged !== null && o.medianLinesClosed !== null) {
    out.push({ section: "outcomes", text: `Merged outside PRs changed a median of ${o.medianLinesMerged} lines; closed ones, ${o.medianLinesClosed}.`, examples: [] });
  }
  if (both) {
    out.push({ section: "outcomes", text: `${pct(o.testsMerged)} of merged outside PRs touched tests, against ${pct(o.testsClosed)} of closed ones.`, examples: o.testsMerged.examples });
    out.push({ section: "outcomes", text: `${pct(o.linkedMerged)} of merged outside PRs were linked to an issue, against ${pct(o.linkedClosed)} of closed ones.`, examples: o.linkedMerged.examples });
  }
  if (o.closed >= MIN_SAMPLE) {
    for (const r of p.closeReasons.filter((r) => r.reason !== "unexplained").slice(0, 4)) {
      out.push({ section: "closed", text: `${r.count} of ${r.of} closed outside PRs: ${CLOSE_REASON_TEXT[r.reason]}.`, examples: r.examples });
    }
  }
  for (const a of p.reviewAsks.filter((a) => a.of >= MIN_SAMPLE && a.count >= MIN_REPEATS).slice(0, 5)) {
    out.push({ section: "review", text: `In ${pct(a)} of reviewed PRs, maintainers asked to ${REVIEW_ASK_TEXT[a.ask]}.`, examples: a.examples });
    const said = a.quotes?.[0];
    if (said) out.push({ section: "review", text: `In a maintainer's words: "${said.text}"`, examples: [said.url] });
  }
  // Any topic, verbatim: the trends a fixed list of categories misses.
  const quoted = new Set(out.filter((f) => f.section === "review").map((f) => f.text));
  for (const v of p.outsideAsks ?? []) {
    const text = `Asked of an outside contributor: "${v.text}"`;
    if (![...quoted].some((q) => q.includes(v.text))) out.push({ section: "review", text, examples: [v.url] });
  }
  // A version 1 profile has no sample size for its median: not stated.
  const r = p.responseHours;
  if (r && r.median !== null && r.q3 !== null) {
    out.push({ section: "pace", text: `A maintainer usually first responds within ${hoursText(r.median)} (half of the ${r.n} outside PRs that got a response); a quarter waited longer than ${hoursText(r.q3)}.`, examples: [] });
  }
  if (o.medianDaysToMerge !== null && o.merged.count >= MIN_SAMPLE) {
    out.push({ section: "pace", text: `Merged outside PRs took a median of ${o.medianDaysToMerge} days from opening to merge.`, examples: [] });
  }
  const c = p.conventions;
  const titled = c.titleTally ? ` (${c.titleTally.count} of ${c.titleTally.of} merged ${c.titleFrom === "outside" ? "outside " : ""}PRs)` : "";
  const titleExamples = c.titleTally?.examples ?? [];
  if (c.title === "conventional") out.push({ section: "conventions", text: `PR titles follow Conventional Commits ("fix: …", "feat(scope): …")${titled}.`, examples: titleExamples });
  if (c.title === "prefix") out.push({ section: "conventions", text: `PR titles start with the area they touch ("area: what changed")${titled}.`, examples: titleExamples });
  if (c.title === "bracket") out.push({ section: "conventions", text: `PR titles start with a tag in brackets ("[area] what changed")${titled}.`, examples: titleExamples });
  // Stated as a count, not an instruction: 3 of 52 (pydantic's release PRs) is no habit for contributors.
  const cl = c.changelogTally;
  if (c.changelogPath && cl) out.push({ section: "conventions", text: `${cl.count} of ${cl.of} merged PRs added a changelog entry, in ${c.changelogPath}.`, examples: cl.examples });
  else if (c.changelogPath) out.push({ section: "conventions", text: `Changelog entries go in ${c.changelogPath}.`, examples: [] });
  if (c.signOffShare !== null && c.signOffShare >= 0.6) out.push({ section: "conventions", text: 'Commits are signed off ("Signed-off-by:", git commit -s).', examples: [] });
  if (p.community) out.push(...communityFindings(p.community).map((f) => ({ section: "community" as const, ...f })));
  return out;
}

/** The window: PRs opened between these many days ago. Old enough that slow
 *  reviews have had a month to happen; recent enough to be today's norms. */
export const COHORT_MIN_AGE_DAYS = 30;
export const COHORT_MAX_AGE_DAYS = 120;
/** A quiet project is read further back, a window at a time, until it has
 *  this many human PRs (nbQA: 5 in four months; earthpy: 3). */
export const COHORT_ENOUGH_PRS = 20;
export const COHORT_WINDOWS: readonly ProfileWindow[] = [
  { minDays: COHORT_MIN_AGE_DAYS, maxDays: COHORT_MAX_AGE_DAYS },
  { minDays: COHORT_MIN_AGE_DAYS, maxDays: 365 },
  { minDays: COHORT_MIN_AGE_DAYS, maxDays: 730 },
];

/** Each window is read in this many equal slices, PROFILE_SAMPLE / COHORT_SLICES
 *  newest PRs from each: newest-first over the whole window would be one busy
 *  week (pandas: three days of Hacktoberfest). */
export const COHORT_SLICES = 3;
/** Largest extra page read when a slice has more PRs than its share and others left budget. */
const PAGE_MAX = 50;
/** Merged PRs scanned for the last outside merge. */
const LAST_MERGE_SCAN = 50;

/** One search per slice of the window, newest slice first. Exported for tests. */
export function cohortQueries(owner: string, name: string, now: Date, window: ProfileWindow = COHORT_WINDOWS[0]): string[] {
  const day = (ago: number) => new Date(now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);
  const edge = (i: number) => window.minDays + Math.round((i * (window.maxDays - window.minDays)) / COHORT_SLICES);
  return Array.from({ length: COHORT_SLICES }, (_, i) =>
    // Search date ranges include both ends: older slices stop a day short of
    // the newer slice's first day, so no PR is read twice.
    `repo:${owner}/${name} is:pr created:${day(edge(i + 1))}..${day(i === 0 ? edge(i) : edge(i) + 1)} sort:created-desc`);
}

const QUERY = `query RepoProfile($owner: String!, $name: String!, $q: String!, $n: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { nameWithOwner hasPullRequestsEnabled isArchived isMirror mirrorUrl homepageUrl }
  search(query: $q, type: ISSUE, first: $n, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number url title state createdAt closedAt mergedAt additions deletions changedFiles authorAssociation
        author { login __typename }
        mergedBy { login __typename }
        labels(first: 10) { nodes { name } }
        closingIssuesReferences { totalCount }
        files(first: 60) { nodes { path } }
        commits(last: 3) { nodes { commit { message } } }
        reviews(first: 8) { totalCount nodes { createdAt body authorAssociation author { login __typename } comments(first: 6) { nodes { body } } } }
        comments(last: 6) { totalCount nodes { createdAt body authorAssociation author { login __typename } } }
        timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { actor { login __typename } } } }
      }
    }
  }
}`;

const MERGES_QUERY = `query RepoProfileMerges($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    nodes { ... on PullRequest { url mergedAt authorAssociation author { login __typename } mergedBy { login __typename } } }
  }
}`;

type RepoNode = { nameWithOwner: string; hasPullRequestsEnabled?: boolean; isArchived?: boolean; isMirror?: boolean; mirrorUrl?: string | null; homepageUrl?: string | null };
type Search = { issueCount?: number; nodes: ProfilePr[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Data = { repository: RepoNode | null; search: Search };
type MergeNode = Pick<ProfilePr, "url" | "mergedAt" | "authorAssociation" | "author" | "mergedBy">;

const ELSEWHERE = /https?:\/\/(?:[\w-]+\.)*(?:codeberg\.org|gitlab\.com|sr\.ht)(?:\/\S*)?/i;

function statusOf(r: RepoNode): RepoStatus {
  return {
    pullRequestsEnabled: r.hasPullRequestsEnabled !== false,
    archived: r.isArchived === true,
    mirror: r.isMirror === true,
    elsewhere: (r.isMirror && r.mirrorUrl) || ELSEWHERE.exec(r.homepageUrl ?? "")?.[0] || null,
  };
}

/** Read and summarize, no cache. Throws RepoNotFoundError or RepoProfileFetchError. */
export async function fetchRepoProfile(client: GitHubClient, repo: string, now = new Date()): Promise<RepoProfile> {
  const [owner, name] = splitRepo(repo);
  const perSlice = Math.ceil(PROFILE_SAMPLE / COHORT_SLICES);
  // Search doesn't follow a moved repository (facebook/react is react/react
  // now), so the first search runs under the name given, and if GitHub knows
  // the repository by another name, it and the rest are read under that one.
  let canonical = `${owner}/${name}`;
  let status = null as RepoStatus | null; // set by search(); the cast keeps TS from narrowing it to null
  const search = async (slice: number, window: ProfileWindow, n: number, cursor: string | null): Promise<Search> => {
    for (;;) {
      const [o, nm] = canonical.split("/");
      let data: Data;
      try {
        data = await client.graphql<Data>(QUERY, { owner: o, name: nm, q: cohortQueries(o, nm, now, window)[slice], n, cursor });
      } catch (error) {
        throw new RepoProfileFetchError(repo, error);
      }
      if (!data?.repository) throw new RepoNotFoundError(repo);
      if (data.repository.nameWithOwner.toLowerCase() !== canonical.toLowerCase()) {
        if (canonical.toLowerCase() !== `${owner}/${name}`.toLowerCase()) throw new RepoProfileFetchError(repo); // moved twice: stop
        canonical = data.repository.nameWithOwner;
        continue; // read this slice again under the current name
      }
      canonical = data.repository.nameWithOwner; // GitHub's spelling of the name
      status ??= statusOf(data.repository);
      // Search hits that are not PRs come back as empty objects.
      return { ...data.search, nodes: data.search.nodes.filter((node) => typeof node?.number === "number") };
    }
  };
  // Each slice's newest perSlice PRs; budget a quiet slice left over goes to
  // a busy one, a page at a time (pyjanitor: 48 PRs in one slice, 5 in another).
  const readWindow = async (window: ProfileWindow) => {
    const slices: Search[] = [];
    for (let i = 0; i < COHORT_SLICES; i++) slices.push(await search(i, window, perSlice, null));
    const prs = slices.flatMap((s) => s.nodes);
    let spare = PROFILE_SAMPLE - prs.length;
    for (const [i, slice] of slices.entries()) {
      let { hasNextPage, endCursor } = slice.pageInfo;
      while (spare > 0 && hasNextPage && endCursor) {
        const more = await search(i, window, Math.min(spare, PAGE_MAX), endCursor);
        if (!more.nodes.length) break;
        prs.push(...more.nodes);
        spare -= more.nodes.length;
        ({ hasNextPage, endCursor } = more.pageInfo);
      }
    }
    return { prs, window: { ...window, opened: slices.reduce((sum, s) => sum + (s.issueCount ?? 0), 0) } };
  };
  const humans = (prs: ProfilePr[]) => prs.filter((pr) => !isBotAuthor(pr.author)).length;
  // Widen while short of human PRs, keeping the window that has the most
  // (the narrower on a tie): a bot-flooded wider window can hold fewer.
  let read = await readWindow(COHORT_WINDOWS[0]);
  let best = humans(read.prs);
  for (const window of COHORT_WINDOWS.slice(1)) {
    // A project that takes no PRs here has no norms to read further back.
    const closedToPrs = status !== null && (!status.pullRequestsEnabled || status.archived || status.mirror);
    if (best >= COHORT_ENOUGH_PRS || closedToPrs) break;
    const wider = await readWindow(window);
    if (humans(wider.prs) > best) [read, best] = [wider, humans(wider.prs)];
  }
  const profile = summarizeProfile(canonical, read.prs, now, read.window);
  profile.status = status ?? undefined;
  // No outside merge in the window: when was the last one? One small search.
  if (profile.outside.merged.count === 0 && status?.pullRequestsEnabled !== false) {
    profile.lastOutsideMerge = await lastOutsideMerge(client, repo, canonical, maintainersOf(read.prs));
  }
  // The policy, the invitations and the community are part of the profile, but
  // a profile without one still helps: each failure is logged and marked unread (null).
  const unread = (what: string) => (error: unknown) => {
    console.warn(`[repo-profile] ${what} of ${canonical} unread:`, error instanceof Error ? error.message : error);
    return null;
  };
  const [o, n] = canonical.split("/");
  const [aiPolicy, wanted, community] = await Promise.all([
    fetchAiPolicy(client, canonical).catch(unread("AI policy")),
    fetchWanted(client, o, n, now).catch(unread("invitations")),
    fetchCommunity(client, o, n, now, maintainersOf(read.prs)).catch(unread("community")),
  ]);
  return { ...profile, aiPolicy, wanted, community };
}

/** The newest merge of an outside PR among the most recently updated merged
 *  PRs (search can't sort by merge date).
 *  ponytail: a merge older than the LAST_MERGE_SCAN most recently updated is reported as none; page if that misleads. */
async function lastOutsideMerge(client: GitHubClient, repo: string, canonical: string, team: Set<string>): Promise<NonNullable<RepoProfile["lastOutsideMerge"]>> {
  let nodes: MergeNode[];
  try {
    const data = await client.graphql<{ search: { nodes: MergeNode[] } }>(MERGES_QUERY, { q: `repo:${canonical} is:pr is:merged sort:updated-desc`, n: LAST_MERGE_SCAN });
    nodes = (data?.search?.nodes ?? []).filter((x) => typeof x?.mergedAt === "string");
  } catch (error) {
    throw new RepoProfileFetchError(repo, error);
  }
  const everyone = new Set([...team, ...maintainersOf(nodes.map((x) => ({ ...x, state: "MERGED" }) as ProfilePr))]);
  const outside = nodes.filter((x) => !isBotAuthor(x.author) && !everyone.has(x.author!.login))
    .sort((a, b) => Date.parse(b.mergedAt!) - Date.parse(a.mergedAt!));
  return { at: outside[0]?.mergedAt ?? null, url: outside[0]?.url ?? null, checked: nodes.length };
}

/** The stored profile if fresh, else read from GitHub and stored on the repo's
 *  row. `refresh` skips the stored copy. */
export async function repoProfile(db: Db, client: GitHubClient, repo: string, opts: { now?: Date; refresh?: boolean } = {}): Promise<RepoProfile> {
  const now = opts.now ?? new Date();
  const [owner, name] = splitRepo(repo);
  const [row] = await db.select({ profile: repos.profile, profiledAt: repos.profiledAt }).from(repos)
    .where(and(sql`lower(${repos.owner}) = ${owner.toLowerCase()}`, sql`lower(${repos.name}) = ${name.toLowerCase()}`)).limit(1);
  if (!opts.refresh && row?.profile && row.profiledAt && now.getTime() - row.profiledAt.getTime() < PROFILE_TTL_MS) {
    return row.profile as RepoProfile;
  }
  const profile = await fetchRepoProfile(client, repo, now);
  const [canonicalOwner, canonicalName] = profile.repo.split("/");
  await db.insert(repos).values({ owner: canonicalOwner, name: canonicalName, profile, profiledAt: now })
    .onConflictDoUpdate({ target: [repos.owner, repos.name], set: { profile, profiledAt: now } });
  return profile;
}

/** For tests: the row a profile was stored on. */
export async function storedProfile(db: Db, owner: string, name: string): Promise<RepoProfile | null> {
  const [row] = await db.select({ profile: repos.profile }).from(repos).where(and(eq(repos.owner, owner), eq(repos.name, name))).limit(1);
  return (row?.profile as RepoProfile | undefined) ?? null;
}
