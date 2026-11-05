// The repository's profile: the unwritten rules a newcomer can't read in
// CONTRIBUTING.md, measured from the project's own recently opened pull
// requests. What gets merged versus closed (and why), what reviewers keep
// asking for, how fast maintainers answer, and the house conventions.
//
// Measured, never guessed: no model writes a claim. Sorting comments into
// close reasons and review requests is fixed patterns, and every finding
// carries its count, its sample size and up to EXAMPLES links to the PRs
// behind it. Repository-level only: no logins, no per-person figures.
//
// GitHub only for now. Chat (Discord, Slack) needs a bot the maintainers
// invite themselves; scraping it is against those services' terms.

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { repos } from "./db/schema";
import type { GitHubClient } from "./gh";
import { splitRepo } from "./ai-policy";
import { isMaintainer, median } from "./recs/health";
import { changelogLocation, isBotAuthor, TEST_PATH, titleConvention, type TitleConvention } from "./maintainer-prefs";

/** PRs read per repository: the newest opened in the cohort window. */
export const PROFILE_SAMPLE = 100;
/** A profile is read again after this long. */
export const PROFILE_TTL_MS = 24 * 60 * 60_000;
/** Fewest PRs a comparison needs before it is stated. */
export const MIN_SAMPLE = 5;
/** A review request is stated once it recurs on this many PRs: one reviewer's
 *  one-off remark is not a norm. */
export const MIN_REPEATS = 3;
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
  reviews: { nodes: Array<Comment & { comments: { nodes: Array<{ body: string }> } | null }> } | null;
  comments: { nodes: Comment[] } | null;
  /** The ClosedEvent's actor: who closed it. */
  timelineItems: { nodes: Array<{ actor?: Author }> } | null;
};

export const CLOSE_REASONS = ["not_assigned", "duplicate", "discuss_first", "out_of_scope", "stale", "ai_generated", "failing_checks", "author_withdrew", "unexplained"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const REVIEW_ASKS = ["tests", "changelog", "docs", "style", "typing", "compatibility", "rebase", "split", "benchmark"] as const;
export type ReviewAsk = (typeof REVIEW_ASKS)[number];

/** A count over a sample, with links to the PRs behind it. */
export type Tally = { count: number; of: number; examples: string[] };

export type RepoProfile = {
  version: 1;
  repo: string;
  computedAt: string;
  /** Creation dates of the PRs read, and how many. */
  window: { from: string | null; to: string | null; prs: number };
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
  };
  /** Why outside PRs were closed without merging, most common first. */
  closeReasons: Array<{ reason: CloseReason } & Tally>;
  /** What maintainers asked for in review, over PRs that got review text. */
  reviewAsks: Array<{ ask: ReviewAsk } & Tally>;
  medianFirstResponseHours: number | null;
  conventions: { title: TitleConvention; changelogPath: string | null; signOffShare: number | null };
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

// Close reasons, matched against what maintainers (or a stale bot) wrote last.
// Order matters: the first match wins.
const CLOSE_PATTERNS: Array<[Exclude<CloseReason, "author_withdrew" | "unexplained">, RegExp]> = [
  // pydantic's bot: "You do not have permission to open a PR without being assigned to the issue".
  ["not_assigned", /(without being assigned|not assigned to (the|this) issue|must be assigned|bypass(ing)? (the )?issue assignment|assign(ed)? (yourself|to the issue) (first|before)|claim the issue first)/i],
  ["ai_generated", /\b(ai[- ]generated|llm[- ]generated|generated (by|with) (an? )?(ai|llm|chatgpt|copilot|claude)|chatgpt|ai slop|slop)\b/i],
  ["duplicate", /\b(duplicate|dupe of|already (been )?(fixed|addressed|done|implemented)|superseded by|in favou?r of #?\d+|closing in favou?r)\b/i],
  ["discuss_first", /\b(open an issue first|discuss(ed|ion)? (this )?(first|before)|before (opening|submitting|sending) a (pr|pull request)|needs? (an? )?(issue|discussion|design|proposal)|not (been )?(agreed|discussed))\b/i],
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

const lines = (pr: ProfilePr) => pr.additions + pr.deletions;
const paths = (pr: ProfilePr) => (pr.files?.nodes ?? []).map((f) => f.path);
const touchesTests = (pr: ProfilePr) => paths(pr).some((p) => TEST_PATH.test(p));
const linked = (pr: ProfilePr) => (pr.closingIssuesReferences?.totalCount ?? 0) > 0;
const round = (value: number | null, places = 0) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places;

function tally(prs: ProfilePr[], test: (pr: ProfilePr) => boolean): Tally {
  const hits = prs.filter(test);
  return { count: hits.length, of: prs.length, examples: hits.slice(0, EXAMPLES).map((pr) => pr.url) };
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
  ].filter((text) => text && text.trim());
}

/** Hours from opening to the first maintainer review or comment, or null. */
function firstResponseHours(pr: ProfilePr, team: Set<string>): number | null {
  const start = Date.parse(pr.createdAt);
  const times = [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].filter(byTeam(team, pr))
    .map((c) => Date.parse(c.createdAt)).filter((t) => Number.isFinite(t) && t >= start);
  return times.length ? (Math.min(...times) - start) / 3_600_000 : null;
}

/** Why a closed PR was closed: its labels, then the last maintainer or bot
 *  comments, then whether its author closed it. Exported for tests. */
export function closeReason(pr: ProfilePr, team: Set<string>): CloseReason {
  for (const [reason, re] of CLOSE_LABELS) if ((pr.labels?.nodes ?? []).some((l) => re.test(l.name))) return reason;
  const notes = (pr.comments?.nodes ?? []).filter((c) => byTeam(team, pr)(c) || isBotAuthor(c.author)).map((c) => c.body);
  for (const note of notes.reverse()) {
    for (const [reason, re] of CLOSE_PATTERNS) if (re.test(note)) return reason;
  }
  const closer = pr.timelineItems?.nodes.at(-1)?.actor?.login;
  return closer && closer === pr.author?.login ? "author_withdrew" : "unexplained";
}

/** The profile from the PRs (pure): every PR opened in the window, newest
 *  first, open ones included so slow outcomes count too. */
export function summarizeProfile(repo: string, prs: ProfilePr[], now = new Date()): RepoProfile {
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
    return { ask, ...tally(reviewed, (pr) => maintainerText(pr, team).some((t) => re.test(t))) };
  }).filter((a) => a.count > 0).sort((a, b) => b.count - a.count);

  const humanMerged = human.filter((pr) => pr.state === "MERGED");
  const locations = new Map<string, number>();
  for (const pr of humanMerged) {
    for (const l of new Set(paths(pr).map(changelogLocation).filter((x): x is string => x !== null))) locations.set(l, (locations.get(l) ?? 0) + 1);
  }
  const signedOff = humanMerged.filter((pr) => (pr.commits?.nodes ?? []).some((c) => /^Signed-off-by: .+<[^>]+>/m.test(c.commit.message))).length;
  // What a newcomer waits for: outside PRs only.
  const responses = outside.map((pr) => firstResponseHours(pr, team)).filter((h): h is number => h !== null);
  const days = merged.map((pr) => pr.mergedAt ? (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 86_400_000 : NaN).filter(Number.isFinite);
  const created = prs.map((pr) => pr.createdAt).sort();

  return {
    version: 1,
    repo,
    computedAt: now.toISOString(),
    window: { from: created[0] ?? null, to: created.at(-1) ?? null, prs: prs.length },
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
    },
    closeReasons: [...reasons.entries()]
      .map(([reason, list]) => ({ reason, count: list.length, of: closed.length, examples: list.slice(0, EXAMPLES).map((pr) => pr.url) }))
      .sort((a, b) => b.count - a.count),
    reviewAsks: asks,
    medianFirstResponseHours: round(median(responses), 1),
    conventions: {
      title: titleConvention(humanMerged.map((pr) => pr.title)),
      changelogPath: [...locations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      signOffShare: humanMerged.length ? round(signedOff / humanMerged.length, 2) : null,
    },
  };
}

export const CLOSE_REASON_TEXT: Record<CloseReason, string> = {
  not_assigned: "opened without being assigned to the issue first",
  duplicate: "a duplicate, or already fixed",
  discuss_first: "maintainers wanted an issue or discussion first",
  out_of_scope: "out of scope or not wanted",
  stale: "went stale",
  ai_generated: "called out as AI-generated",
  failing_checks: "tests or CI failing",
  author_withdrew: "closed by its own author",
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

/** One readable finding with what backs it. */
export type Finding = { section: "outcomes" | "closed" | "review" | "pace" | "conventions"; text: string; examples: string[] };

const pct = (t: Tally) => `${Math.round((t.count / t.of) * 100)}%`;
const hoursText = (h: number) => h < 1 ? "under an hour" : h < 48 ? `about ${Math.round(h)} hours` : `about ${Math.round(h / 24)} days`;

/** The profile as sentences, for the page and the harness's agent context.
 *  A comparison is stated only when both sides have MIN_SAMPLE PRs. */
export function profileFindings(p: RepoProfile): Finding[] {
  const out: Finding[] = [];
  const o = p.outside;
  if (o.merged.of >= MIN_SAMPLE) {
    const open = o.open.count === 0 ? "" : ` and ${o.open.count} ${o.open.count === 1 ? "is" : "are"} still open`;
    out.push({ section: "outcomes", text: `Of ${o.merged.of} PRs outside contributors opened 1–4 months ago, ${o.merged.count} were merged (${pct(o.merged)}), ${o.closed} closed${open}.`, examples: o.merged.examples });
    if (o.open.count >= MIN_SAMPLE) {
      out.push({ section: "pace", text: `${pct(o.open)} of outside PRs are still open a month or more after they were opened.`, examples: o.open.examples });
    }
  }
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
  }
  if (p.medianFirstResponseHours !== null) out.push({ section: "pace", text: `A maintainer usually first responds within ${hoursText(p.medianFirstResponseHours)}.`, examples: [] });
  if (o.medianDaysToMerge !== null && o.merged.count >= MIN_SAMPLE) {
    out.push({ section: "pace", text: `Merged outside PRs took a median of ${o.medianDaysToMerge} days from opening to merge.`, examples: [] });
  }
  const c = p.conventions;
  if (c.title === "conventional") out.push({ section: "conventions", text: 'PR titles follow Conventional Commits ("fix: …", "feat(scope): …").', examples: [] });
  if (c.title === "prefix") out.push({ section: "conventions", text: 'PR titles start with the area they touch ("area: what changed").', examples: [] });
  if (c.title === "bracket") out.push({ section: "conventions", text: 'PR titles start with a tag in brackets ("[area] what changed").', examples: [] });
  if (c.changelogPath) out.push({ section: "conventions", text: `Changelog entries go in ${c.changelogPath}.`, examples: [] });
  if (c.signOffShare !== null && c.signOffShare >= 0.6) out.push({ section: "conventions", text: 'Commits are signed off ("Signed-off-by:", git commit -s).', examples: [] });
  return out;
}

/** The window: PRs opened between these many days ago. Old enough that slow
 *  reviews have had a month to happen; recent enough to be today's norms. */
export const COHORT_MIN_AGE_DAYS = 30;
export const COHORT_MAX_AGE_DAYS = 120;

/** The window is read in this many equal slices, PROFILE_SAMPLE / COHORT_SLICES
 *  newest PRs from each: newest-first over the whole window would be one busy
 *  week (pandas: three days of Hacktoberfest). */
export const COHORT_SLICES = 3;

/** One search per slice, newest slice first. Exported for tests. */
export function cohortQueries(owner: string, name: string, now: Date): string[] {
  const day = (ago: number) => new Date(now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);
  const span = (COHORT_MAX_AGE_DAYS - COHORT_MIN_AGE_DAYS) / COHORT_SLICES;
  return Array.from({ length: COHORT_SLICES }, (_, i) => {
    const newest = COHORT_MIN_AGE_DAYS + i * span;
    // Search date ranges include both ends: older slices stop a day short of
    // the newer slice's first day, so no PR is read twice.
    return `repo:${owner}/${name} is:pr created:${day(newest + span)}..${day(i === 0 ? newest : newest + 1)} sort:created-desc`;
  });
}

const QUERY = `query RepoProfile($owner: String!, $name: String!, $q: String!, $n: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { nameWithOwner }
  search(query: $q, type: ISSUE, first: $n, after: $cursor) {
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
        reviews(first: 8) { nodes { createdAt body authorAssociation author { login __typename } comments(first: 6) { nodes { body } } } }
        comments(last: 6) { nodes { createdAt body authorAssociation author { login __typename } } }
        timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { actor { login __typename } } } }
      }
    }
  }
}`;

type Data = {
  repository: { nameWithOwner: string } | null;
  search: { nodes: ProfilePr[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

/** Read and summarize, no cache. Throws RepoNotFoundError or RepoProfileFetchError. */
export async function fetchRepoProfile(client: GitHubClient, repo: string, now = new Date()): Promise<RepoProfile> {
  const [owner, name] = splitRepo(repo);
  const perSlice = Math.ceil(PROFILE_SAMPLE / COHORT_SLICES);
  const prs: ProfilePr[] = [];
  let canonical = `${owner}/${name}`;
  for (const q of cohortQueries(owner, name, now)) {
    let data: Data;
    try {
      data = await client.graphql<Data>(QUERY, { owner, name, q, n: perSlice, cursor: null });
    } catch (error) {
      throw new RepoProfileFetchError(repo, error);
    }
    if (!data?.repository) throw new RepoNotFoundError(repo);
    canonical = data.repository.nameWithOwner;
    // Search hits that are not PRs come back as empty objects.
    prs.push(...data.search.nodes.filter((node) => typeof node?.number === "number"));
  }
  return summarizeProfile(canonical, prs, now);
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
