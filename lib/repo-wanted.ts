// What maintainers are looking for: the labels a project uses to invite
// contributions, how many open issues carry them, whether those invitations
// pay off (were recently closed invited issues fixed by outside contributors?),
// and the issues the maintainers pinned.
//
// Same rules as the repo profile (repo-profile.ts): measured, never guessed.
// Labels are matched with a fixed pattern list, outcomes are counted, every
// finding carries its counts and up to EXAMPLES links. Repository-level only:
// logins are read to tell maintainers from outsiders and never leave summarizeWanted.

import type { GitHubClient } from "./gh";
import { splitRepo } from "./ai-policy";
import { isMaintainer } from "./recs/health";
import { isBotAuthor } from "./maintainer-prefs";
import { COHORT_MAX_AGE_DAYS, COHORT_MIN_AGE_DAYS, EXAMPLES, MIN_SAMPLE, RepoNotFoundError, windowText, type Tally } from "./repo-profile";

/** Labels that invite contributions, matched case-insensitively against each
 *  label's whole name. Fixed on purpose: "hacktoberfest-accepted" marks a PR
 *  that counts for Hacktoberfest, not an issue anyone wants fixed. */
export const INVITE_LABELS: readonly RegExp[] = [
  /\bhelp[\s_-]*wanted\b/i,
  /\bgood[\s_-]*(first|second|starter|intermediate)[\s_-]*(issue|bug|pr|contribution)s?\b/i,
  /\bfirst[\s_-]*timers?[\s_-]*only\b/i,
  /\b(contributions?|prs?|pull[\s_-]*requests?|patch(es)?)[\s_-]*welcome\b/i,
  /^((status|state|triage)[\s:/_-]*)?accepted$/i,
  /^((difficulty|level)[\s:/_-]*)?(easy|beginner)([\s_-]*(fix|pick|issue))?$/i,
  /\bbeginner[\s_-]*friendly\b/i,
  /\bup[\s_-]*for[\s_-]*grabs\b/i,
];
export const isInviteLabel = (name: string) => INVITE_LABELS.some((re) => re.test(name.trim()));

/** Invitation labels looked up per repository: one aliased field each. */
export const MAX_LABELS = 10;
/** Closed invited issues read per repository (newest first). */
export const WANTED_SAMPLE = 100;
/** Label pages read (100 labels each): pandas has 158 labels. */
const LABEL_PAGES = 5;

type Author = { login: string; __typename?: string } | null;
export type WantedPr = { url: string; merged: boolean; author: Author; authorAssociation: string; mergedBy: Author };
/** A closed issue that carries an invitation label. */
export type WantedIssue = {
  url: string;
  author: Author;
  /** Merged and open PRs that say they close it ("fixes #12"). */
  closedByPullRequestsReferences: { nodes: WantedPr[] } | null;
  /** The ClosedEvent: who closed it, and the PR or commit that did, if any. */
  timelineItems: { nodes: Array<{ actor?: Author; closer?: (Partial<WantedPr> & { __typename?: string }) | null }> } | null;
};
/** An open issue under an invitation label: free when nobody is assigned and no open PR closes it. */
export type WantedOpenIssue = {
  url: string; createdAt?: string;
  assignees?: { totalCount: number } | null;
  closedByPullRequestsReferences?: { totalCount: number } | null;
};
export type WantedLabelNode = { name: string; issues: { totalCount: number; nodes: WantedOpenIssue[] } };
/** Open issues read per label to tell free ones from taken ones. */
export const LABEL_ISSUES_READ = 20;

export type RepoWanted = {
  version: 1;
  repo: string;
  computedAt: string;
  openIssues: number;
  /** Each invitation label: open issues carrying it, of all open issues, most used first. */
  /** `free`/`read`: of the newest `read` open issues, how many nobody is
   *  assigned to and no open PR closes; `newest`: the newest one's creation. */
  labels: Array<{ name: string; free?: number; read?: number; newest?: string | null } & Tally>;
  /** Invited issues closed in the window (closed dates, both ends included). */
  closed: {
    /** How many the search matched; the tallies are over the WANTED_SAMPLE newest opened. */
    total: number;
    from: string;
    to: string;
    /** Closed by a merged PR from outside the maintainer team; examples are the PRs. */
    outside: Tally;
    /** Closed by a merged PR from a maintainer or a bot. */
    team: Tally;
    /** Closed with no merged PR: by hand, as not planned, as a duplicate, or by a commit. */
    unmerged: Tally;
  };
  /** The issues pinned to the repository's Issues tab (GitHub allows three). */
  pinned: Array<{ title: string; url: string }>;
};

export type WantedInput = {
  openIssues: number;
  labels: WantedLabelNode[];
  closed: WantedIssue[];
  /** The search's match count; `closed.length` when every match was read. */
  closedTotal?: number;
  pinned: Array<{ title: string; url: string }>;
};

export class RepoWantedFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s contribution labels and issues.`, { cause });
    this.name = "RepoWantedFetchError";
  }
}

const day = (now: Date, ago: number) => new Date(now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);

/** The merged PR that closed the issue: the ClosedEvent's closer, else a merged
 *  PR that references it (closed by hand after the merge). */
function closingPr(issue: WantedIssue): WantedPr | null {
  const closer = issue.timelineItems?.nodes.at(-1)?.closer;
  if (closer?.__typename === "PullRequest" && closer.merged && closer.url) return closer as WantedPr;
  return issue.closedByPullRequestsReferences?.nodes.find((pr) => pr.merged) ?? null;
}

/** Who acts as a maintainer here: merged a PR, closed someone else's issue, or
 *  is OWNER/MEMBER/COLLABORATOR. ponytail: from the invited issues alone, so a
 *  maintainer with private membership who did neither counts as outside; pass
 *  the profile's team in if that ever shows up. */
function teamOf(issues: WantedIssue[]): Set<string> {
  const team = new Set<string>();
  const add = (a: Author | undefined) => { if (a?.login && !isBotAuthor(a)) team.add(a.login); };
  for (const issue of issues) {
    const actor = issue.timelineItems?.nodes.at(-1)?.actor;
    if (actor?.login !== issue.author?.login) add(actor);
    const pr = closingPr(issue);
    if (pr) {
      add(pr.mergedBy);
      if (isMaintainer(pr.authorAssociation)) add(pr.author);
    }
  }
  return team;
}

/** The signal from what GitHub returned (pure). */
export function summarizeWanted(repo: string, input: WantedInput, now = new Date()): RepoWanted {
  const team = teamOf(input.closed);
  const outside: string[] = [], mine: string[] = [], unmerged: string[] = [];
  for (const issue of input.closed) {
    const pr = closingPr(issue);
    if (!pr) unmerged.push(issue.url);
    else if (isBotAuthor(pr.author) || team.has(pr.author!.login)) mine.push(pr.url);
    else outside.push(pr.url);
  }
  const of = input.closed.length;
  const tally = (urls: string[]): Tally => ({ count: urls.length, of, examples: urls.slice(0, EXAMPLES) });
  return {
    version: 1,
    repo,
    computedAt: now.toISOString(),
    openIssues: input.openIssues,
    labels: input.labels
      .map((l) => {
        // pyjanitor: 7 "good first issue", all from 2019–20, several assigned or with a PR already.
        // Only issues read with their assignees and linked PRs can be called free or taken.
        const known = l.issues.nodes.filter((i) => i.createdAt !== undefined && i.assignees !== undefined && i.closedByPullRequestsReferences !== undefined);
        const isFree = (i: WantedOpenIssue) => !(i.assignees?.totalCount) && !(i.closedByPullRequestsReferences?.totalCount);
        const free = known.filter(isFree);
        const rest = l.issues.nodes.filter((i) => !free.includes(i));
        const dates = known.map((i) => i.createdAt!).sort();
        return {
          name: l.name, count: l.issues.totalCount, of: input.openIssues,
          examples: [...free, ...rest].slice(0, EXAMPLES).map((i) => i.url),
          free: free.length, read: known.length, newest: dates.at(-1) ?? null,
        };
      })
      .sort((a, b) => b.count - a.count),
    closed: { total: Math.max(input.closedTotal ?? 0, of), from: day(now, COHORT_MAX_AGE_DAYS), to: day(now, COHORT_MIN_AGE_DAYS), outside: tally(outside), team: tally(mine), unmerged: tally(unmerged) },
    pinned: input.pinned,
  };
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
const quoted = (names: string[], join = "or") => names.map((n) => `"${n}"`).reduce((acc, n, i, all) => i === 0 ? n : `${acc}${i === all.length - 1 ? ` ${join}` : ","} ${n}`, "");
const pct = (t: Tally) => `${Math.round((t.count / t.of) * 100)}%`;

/** The signal as sentences. Whether invitations pay off is stated only when
 *  MIN_SAMPLE invited issues closed in the window. */
export function wantedFindings(w: RepoWanted): Array<{ text: string; examples: string[] }> {
  const out: Array<{ text: string; examples: string[] }> = [];
  const used = w.labels.filter((l) => l.count > 0);
  if (!w.labels.length) {
    out.push({ text: 'None of the project\'s issue labels is a usual invitation to contribute ("help wanted", "good first issue" or similar).', examples: [] });
  } else if (!used.length) {
    const one = w.labels.length === 1;
    out.push({ text: `The project has the label${one ? "" : "s"} ${quoted(w.labels.map((l) => l.name), "and")}, but no open issue carries ${one ? "it" : "them"} now.`, examples: [] });
  }
  for (const l of used) {
    let state = "";
    if (l.read !== undefined && l.free !== undefined && l.read > 0) {
      const of = l.read < l.count ? ` of the newest ${l.read}` : "";
      const newest = l.newest ? `; the newest was opened ${new Date(l.newest).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}` : "";
      state = l.free === 0
        ? ` None${of} is free: each is assigned or already has an open PR${newest}.`
        : ` ${l.free}${of} ${l.free === 1 ? "is" : "are"} free (nobody assigned, no open PR)${newest}.`;
    }
    out.push({ text: `${l.count} of ${l.of} open issues ${l.count === 1 ? "is" : "are"} labelled "${l.name}".${state}`, examples: l.examples });
  }
  const c = w.closed;
  if (c.outside.of >= MIN_SAMPLE) {
    out.push({
      text: `Of ${c.outside.of} issues labelled ${quoted(w.labels.map((l) => l.name))} that were closed ${windowText(COHORT_MIN_AGE_DAYS, COHORT_MAX_AGE_DAYS)}${c.total > c.outside.of ? ` (the ${c.outside.of} most recently opened of ${c.total})` : ""}, ${c.outside.count} (${pct(c.outside)}) were fixed by an outside contributor's merged PR, ${c.team.count} by a maintainer's own PR, and ${c.unmerged.count} closed without a merged PR.`,
      examples: c.outside.examples,
    });
  }
  for (const p of w.pinned) out.push({ text: `Pinned by the maintainers: "${p.title}".`, examples: [p.url] });
  return out;
}

const REPO_QUERY = `query RepoWantedLabels($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    issues(states: OPEN) { totalCount }
    pinnedIssues(first: 3) { nodes { issue { title url } } }
    labels(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { name } }
  }
}`;

type RepoData = {
  repository: {
    nameWithOwner: string;
    issues: { totalCount: number };
    pinnedIssues: { nodes: Array<{ issue: { title: string; url: string } | null }> };
    labels: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ name: string }> };
  } | null;
};

/** One aliased `label(name:)` field per invitation label; the names travel as variables. */
function labelsQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `, $l${i}: String!`).join("");
  const fields = Array.from({ length: count }, (_, i) =>
    `l${i}: label(name: $l${i}) { name issues(states: OPEN, first: ${LABEL_ISSUES_READ}, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { url createdAt assignees { totalCount } closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount } } } }`).join("\n    ");
  return `query RepoWantedCounts($owner: String!, $name: String!${vars}) {\n  repository(owner: $owner, name: $name) {\n    ${fields}\n  }\n}`;
}

const PR_FIELDS = "url merged authorAssociation author { login __typename } mergedBy { login __typename }";
const SEARCH_QUERY = `query RepoWantedClosed($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        url
        author { login __typename }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: false) { nodes { ${PR_FIELDS} } }
        timelineItems(itemTypes: [CLOSED_EVENT], last: 1) {
          nodes { ... on ClosedEvent { actor { login __typename } closer { __typename ... on PullRequest { ${PR_FIELDS} } } } }
        }
      }
    }
  }
}`;

type SearchData = { search: { issueCount: number; nodes: WantedIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

/** The search for invited issues closed in the window. Search can't escape a
 *  quote, so a label with one in its name is left out. Exported for tests. */
export function closedQuery(repo: string, labels: string[], now: Date): string {
  const names = labels.filter((l) => !l.includes('"')).map((l) => `"${l}"`).join(",");
  return `repo:${repo} is:issue is:closed label:${names} closed:${day(now, COHORT_MAX_AGE_DAYS)}..${day(now, COHORT_MIN_AGE_DAYS)} sort:created-desc`;
}

/** Read and summarize, no cache. Throws RepoNotFoundError, RepoWantedFetchError,
 *  or InvalidRepoNameError for a malformed name. */
export async function fetchWanted(client: GitHubClient, owner: string, name: string, now = new Date()): Promise<RepoWanted> {
  const [o, n] = splitRepo(`${owner}/${name}`);
  const repo = `${o}/${n}`;
  const ask = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    try {
      const data = await client.graphql<T>(query, variables);
      if (!data) throw new Error("empty GraphQL response");
      return data;
    } catch (error) {
      throw new RepoWantedFetchError(repo, error);
    }
  };

  const first = await ask<RepoData>(REPO_QUERY, { owner: o, name: n, cursor: null });
  if (!first.repository) throw new RepoNotFoundError(repo);
  // repository() follows a move; search doesn't, so everything after runs under GitHub's name.
  const canonical = first.repository.nameWithOwner;
  const [co, cn] = canonical.split("/");
  const names = first.repository.labels.nodes.map((l) => l.name);
  let page = first.repository.labels.pageInfo;
  for (let i = 1; i < LABEL_PAGES && page.hasNextPage; i++) {
    const next = await ask<RepoData>(REPO_QUERY, { owner: co, name: cn, cursor: page.endCursor });
    if (!next.repository) throw new RepoWantedFetchError(repo, new Error("repository vanished while paging labels"));
    names.push(...next.repository.labels.nodes.map((l) => l.name));
    page = next.repository.labels.pageInfo;
  }

  const invited = names.filter(isInviteLabel).slice(0, MAX_LABELS);
  let labels: WantedLabelNode[] = [];
  const closed: WantedIssue[] = [];
  let closedTotal = 0;
  if (invited.length) {
    const vars = Object.fromEntries(invited.map((l, i) => [`l${i}`, l]));
    const counts = await ask<{ repository: Record<string, WantedLabelNode | null> | null }>(labelsQuery(invited.length), { owner: co, name: cn, ...vars });
    if (!counts.repository) throw new RepoWantedFetchError(repo, new Error("repository vanished while counting labels"));
    labels = invited.map((_, i) => counts.repository![`l${i}`]).filter((l): l is WantedLabelNode => Boolean(l));

    const q = closedQuery(canonical, invited, now);
    let cursor: string | null = null;
    while (closed.length < WANTED_SAMPLE) {
      const data: SearchData = await ask<SearchData>(SEARCH_QUERY, { q, cursor });
      if (!data.search) throw new RepoWantedFetchError(repo, new Error("search returned no result"));
      // Search hits that are not issues come back as empty objects.
      closed.push(...data.search.nodes.filter((node) => typeof node?.url === "string"));
      closedTotal = data.search.issueCount;
      if (!data.search.pageInfo.hasNextPage || !data.search.pageInfo.endCursor) break;
      cursor = data.search.pageInfo.endCursor;
    }
  }

  const pinned = first.repository.pinnedIssues.nodes.flatMap((p) => p.issue ? [{ title: p.issue.title, url: p.issue.url }] : []);
  return summarizeWanted(canonical, { openIssues: first.repository.issues.totalCount, labels, closed: closed.slice(0, WANTED_SAMPLE), closedTotal, pinned }, now);
}
