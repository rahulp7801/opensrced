// "How <repo> likes PRs": facts measured from the repository's most recent
// merged PRs, read from GitHub in one GraphQL call and summarized without a
// model. Shown at lesson kickoff and before publish, and given to the teacher
// (fenced as untrusted data: titles and paths are the repo's text).
//
// Aggregates only: sizes, shares, a title convention and a changelog
// location. No PR titles, numbers or changed files beyond the changelog's, so
// the card can never point at a recent fix for the lesson's own issue.

import type { GitHubClient } from "./gh";
import { splitRepo } from "./ai-policy";
import { firstMaintainerResponseHours, median } from "./recs/health";

/** How many recent merged PRs are read. */
export const PREFS_SAMPLE = 30;
/** How long a repo's prefs are reused before they are read again. */
export const PREFS_TTL_MS = 12 * 60 * 60_000;
/** A convention or sign-off counts as the norm at this share of PRs. */
export const NORM_SHARE = 0.6;

type Author = { login: string; __typename?: string } | null;
type Event = { createdAt: string; authorAssociation?: string | null; author?: Author };
export type MergedPrNode = {
  title: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  author: Author;
  files: { nodes: Array<{ path: string }> } | null;
  commits: { nodes: Array<{ commit: { message: string } }> } | null;
  reviews: { nodes: Event[] } | null;
  comments: { nodes: Event[] } | null;
};

export type TitleConvention = "conventional" | "prefix" | "bracket" | "none";

export type MaintainerPrefs = {
  repo: string;
  /** Human-written PRs the figures come from (bots left out). */
  sample: number;
  medianFiles: number | null;
  medianLines: number | null;
  /** 0–1 shares of the sample. */
  testsShare: number | null;
  changelogShare: number | null;
  /** Where entries go: "CHANGELOG.md", or a directory such as "changes/". */
  changelogPath: string | null;
  titleConvention: TitleConvention;
  signOffShare: number | null;
  prTemplate: boolean;
  medianFirstReviewHours: number | null;
};

export class MaintainerPrefsFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s recent merged pull requests.`, { cause });
    this.name = "MaintainerPrefsFetchError";
  }
}

const BOT_LOGINS = /\[bot\]$|^(dependabot|renovate|pre-commit-ci|github-actions|allcontributors)$/i;
const isBot = (a: Author) => !a || a.__typename === "Bot" || BOT_LOGINS.test(a.login);

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing)\/|(^|\/)test_[^/]+$|[._-](test|spec)\.[a-z]+$|_test\.go$/i;
/** A changelog file, or a fragment directory (towncrier, changesets, reno,
 *  CPython's Misc/NEWS.d), at the root or under docs/: a code folder that
 *  happens to be called news/ deeper down is not one. */
const CHANGELOG_FILE = /^(?:docs?\/)?(changelog|changes|history|news|release[-_ ]?notes)(\.(md|rst|txt|adoc))?$/i;
const CHANGELOG_DIR = /^((?:docs?\/|misc\/)?(?:changelog\.d|changes|newsfragments|news\.d|news|\.changeset|changelog|releasenotes\/notes)\/)/i;

/** The changelog location a path is an entry in, or null. */
export function changelogLocation(path: string): string | null {
  const dir = CHANGELOG_DIR.exec(path);
  if (dir) return dir[1];
  return CHANGELOG_FILE.test(path) ? path : null;
}

const CONVENTIONAL = /^(feat|fix|docs?|chore|refactor|test|tests|ci|build|perf|style|revert|deps)(\([^)]{1,40}\))?!?: \S/i;
const PREFIX = /^[\w./-]{1,30}: \S/;
const BRACKET = /^\[[^\]]{1,30}\] ?\S/;

/** The title style most PRs share, if any reaches NORM_SHARE. */
export function titleConvention(titles: string[]): TitleConvention {
  if (!titles.length) return "none";
  const share = (re: RegExp) => titles.filter((t) => re.test(t.trim())).length / titles.length;
  if (share(CONVENTIONAL) >= NORM_SHARE) return "conventional";
  if (share(PREFIX) >= NORM_SHARE) return "prefix";
  if (share(BRACKET) >= NORM_SHARE) return "bracket";
  return "none";
}

const round = (value: number | null, places = 0) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places;
const shareOf = (count: number, total: number) => total ? round(count / total, 2) : null;

/** The figures from the PRs (pure). */
export function summarizePrefs(repo: string, prs: MergedPrNode[], prTemplate: boolean): MaintainerPrefs {
  const human = prs.filter((pr) => !isBot(pr.author));
  const paths = human.map((pr) => (pr.files?.nodes ?? []).map((f) => f.path));
  const locations = new Map<string, number>();
  let changelog = 0;
  for (const list of paths) {
    const found = new Set(list.map(changelogLocation).filter((l): l is string => l !== null));
    if (found.size) changelog++;
    for (const l of found) locations.set(l, (locations.get(l) ?? 0) + 1);
  }
  const signedOff = human.filter((pr) => (pr.commits?.nodes ?? []).some((c) => /^Signed-off-by: .+<[^>]+>/m.test(c.commit.message))).length;
  const reviewHours = human.map((pr) => firstMaintainerResponseHours(pr.createdAt, pr.author?.login,
    [...(pr.reviews?.nodes ?? []), ...(pr.comments?.nodes ?? [])].filter((e) => !isBot(e.author ?? null)))).filter((h): h is number => h !== null);
  return {
    repo,
    sample: human.length,
    medianFiles: round(median(human.map((pr) => pr.changedFiles))),
    medianLines: round(median(human.map((pr) => pr.additions + pr.deletions))),
    testsShare: shareOf(paths.filter((list) => list.some((p) => TEST_PATH.test(p))).length, human.length),
    changelogShare: shareOf(changelog, human.length),
    changelogPath: [...locations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    titleConvention: titleConvention(human.map((pr) => pr.title)),
    signOffShare: shareOf(signedOff, human.length),
    prTemplate,
    medianFirstReviewHours: round(median(reviewHours), 1),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const hours = (h: number) => h < 1 ? "under an hour" : h < 48 ? `about ${Math.round(h)} hours` : `about ${Math.round(h / 24)} days`;
const CONVENTION_TEXT: Record<Exclude<TitleConvention, "none">, string> = {
  conventional: 'Titles follow Conventional Commits ("fix: …", "feat(scope): …").',
  prefix: 'Titles start with the area they touch ("area: what changed").',
  bracket: 'Titles start with a tag in brackets ("[area] what changed").',
};

/** The card's lines, also the teacher's note. Empty when nothing was measured. */
export function prefsLines(p: MaintainerPrefs): string[] {
  if (!p.sample) return [];
  const lines: string[] = [];
  if (p.medianFiles !== null && p.medianLines !== null) lines.push(`A typical merged PR changes ${p.medianFiles} file${p.medianFiles === 1 ? "" : "s"} and ${p.medianLines} lines (median of ${p.sample}).`);
  if (p.testsShare !== null) lines.push(`${pct(p.testsShare)} of them touch tests.`);
  if (p.changelogShare) lines.push(`${pct(p.changelogShare)} add a changelog entry${p.changelogPath ? ` (in ${p.changelogPath})` : ""}.`);
  if (p.titleConvention !== "none") lines.push(CONVENTION_TEXT[p.titleConvention]);
  if (p.signOffShare !== null && p.signOffShare >= NORM_SHARE) lines.push(`Commits are signed off (git commit -s, "Signed-off-by:"); ${pct(p.signOffShare)} of PRs do.`);
  lines.push(p.prTemplate ? "The repository has a pull request template: fill it in." : "There is no pull request template.");
  if (p.medianFirstReviewHours !== null) lines.push(`A maintainer usually first responds within ${hours(p.medianFirstReviewHours)}.`);
  return lines;
}

const QUERY = `query MaintainerPrefs($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequestTemplates { filename }
    pullRequests(states: MERGED, first: $n, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        title additions deletions changedFiles createdAt
        author { login __typename }
        files(first: 100) { nodes { path } }
        commits(last: 5) { nodes { commit { message } } }
        reviews(first: 5) { nodes { createdAt authorAssociation author { login __typename } } }
        comments(first: 5) { nodes { createdAt authorAssociation author { login __typename } } }
      }
    }
  }
}`;

/** Read and summarize (no cache). Throws MaintainerPrefsFetchError. */
export async function fetchMaintainerPrefs(client: GitHubClient, repo: string): Promise<MaintainerPrefs> {
  const [owner, name] = splitRepo(repo);
  type Data = { repository: { pullRequestTemplates: Array<{ filename: string }> | null; pullRequests: { nodes: MergedPrNode[] } } | null };
  let data: Data;
  try {
    data = await client.graphql<Data>(QUERY, { owner, name, n: PREFS_SAMPLE });
  } catch (error) {
    throw new MaintainerPrefsFetchError(repo, error);
  }
  if (!data?.repository) throw new MaintainerPrefsFetchError(repo);
  return summarizePrefs(`${owner}/${name}`, data.repository.pullRequests.nodes, Boolean(data.repository.pullRequestTemplates?.length));
}

// ponytail: per-instance cache like lib/ai-policy.ts; a repos column once the DB is everywhere.
const cache = new Map<string, { prefs: MaintainerPrefs; expiresAt: number }>();

/** The prefs, read at most once per PREFS_TTL_MS per repository. */
export async function maintainerPrefs(client: GitHubClient, repo: string, now = Date.now()): Promise<MaintainerPrefs> {
  const key = splitRepo(repo).join("/").toLowerCase();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.prefs;
  const prefs = await fetchMaintainerPrefs(client, repo);
  if (cache.size >= 2_000) cache.clear();
  cache.set(key, { prefs, expiresAt: now + PREFS_TTL_MS });
  return prefs;
}

/** For tests. */
export function clearMaintainerPrefsCache(): void {
  cache.clear();
}
