// Personalised ranking (PLAN.md §6.4, PFIRec-inspired, rule-based first):
//
//   score = fit(level, difficulty)
//         + 0.3 · language_match    (repositoriesContributedTo + past lessons)
//         + 0.4 · known_area        (map_coverage ∩ scope_nodes)
//         + 0.2 · repo_responsiveness
//         + 0.1 · has_worked_examples
//         − 1.0 · unreachable_for_level
//
// Weights in lib/recs/weights.ts RANK. Feeds: "for-you", "continue" (repos
// whose code the user knows) and "explore" (filters, no personal signals).

import { sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { flagEnabled } from "../flags";
import type { GitHubClient } from "../gh";
import { responsiveness, type RepoHealth } from "./health";
import type { IssueFeatures } from "./ingest";
import { rowsOf } from "./similar";
import { RANK, type Level } from "./weights";

const LEVELS: Level[] = ["Newcomer", "Contributor", "Regular", "Trusted"];

/** users.level → name. Everyone is a Newcomer until the record stream exists. */
export function levelName(level: number | null | undefined): Level {
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, Math.floor(level ?? 0)))];
}

/** 1 inside the level's preferred difficulties, 0.5 one step outside, else 0. */
export function fit(level: Level, difficulty: number): number {
  const [low, high] = RANK.fit[level];
  if (difficulty >= low && difficulty <= high) return 1;
  return difficulty === low - 1 || difficulty === high + 1 ? 0.5 : 0;
}

export type Candidate = {
  repoId: number;
  repo: string; // owner/name
  language: string | null;
  number: number;
  title: string;
  url: string;
  labels: string[];
  difficulty: number | null;
  reasons: string[];
  scopeNodes: string[];
  workedExamples: number;
  health: Partial<RepoHealth> | null;
  /** The repo's newest env recipe is green: its tests run here (Phase 1). */
  testable: boolean;
  /** Why the repo can't be run here, when its recipe says so. */
  unreachableReason: string | null;
  createdAt: string;
};

export type UserProfile = {
  level: Level;
  /** Lowercase. */
  languages: string[];
  /** Graph nodes the user has explored, explained or changed, per repo id. */
  known: Map<number, Set<string>>;
};

export type Ranked = Candidate & { score: number; why: string[] };

/** Share of the issue's graph nodes the user already knows (file: tokens aren't graph nodes). */
export function knownArea(candidate: Pick<Candidate, "repoId" | "scopeNodes">, user: UserProfile): number {
  const known = user.known.get(candidate.repoId);
  const nodes = candidate.scopeNodes.filter((node) => !node.startsWith("file:"));
  if (!known?.size || !nodes.length) return 0;
  return nodes.filter((node) => known.has(node)).length / nodes.length;
}

export function rankCandidate(candidate: Candidate, user: UserProfile, knownAreaWeight: number = RANK.knownArea): Ranked {
  const why: string[] = [];
  let score = 0;
  if (candidate.difficulty !== null) {
    const f = fit(user.level, candidate.difficulty);
    score += f;
    if (f === 1) why.push(`difficulty ${candidate.difficulty} suits a ${user.level}`);
  }
  if (candidate.language && user.languages.includes(candidate.language.toLowerCase())) {
    score += RANK.languageMatch;
    why.push(`in ${candidate.language}, which you've worked in`);
  }
  const known = knownArea(candidate, user);
  if (known > 0) {
    score += knownAreaWeight * known;
    why.push("touches code you know");
  }
  const responsive = responsiveness(candidate.health);
  score += RANK.responsiveness * responsive;
  if (responsive === 1) why.push("maintainers reply within a few days");
  if (candidate.workedExamples > 0) {
    score += RANK.workedExamples;
    why.push(`${candidate.workedExamples} worked example${candidate.workedExamples === 1 ? "" : "s"}`);
  }
  // §5.9: repos needing a GPU, secrets or a non-Linux host stay out of a
  // Newcomer's feed; everyone else sees them with the reason.
  if (candidate.unreachableReason !== null && user.level === "Newcomer") score += RANK.unreachableForLevel;
  return { ...candidate, score: Math.round(score * 1000) / 1000, why };
}

export type CandidateFilter = {
  repoIds?: number[];
  language?: string;
  maxDifficulty?: number;
  testableOnly?: boolean;
  limit?: number;
};

type CandidateRow = Omit<Candidate, "repo" | "url" | "reasons" | "scopeNodes" | "workedExamples" | "testable" | "createdAt"> & {
  owner: string; name: string; reasons: unknown; scopeNodes: string[] | null; features: IssueFeatures | null;
  envStatus: string | null; createdAt: string | Date;
};

function toCandidate(row: CandidateRow): Candidate {
  const repo = `${row.owner}/${row.name}`;
  return {
    repoId: row.repoId, repo, language: row.language, number: row.number, title: row.title,
    url: `https://github.com/${repo}/issues/${row.number}`, labels: row.labels,
    difficulty: row.difficulty === null ? null : Number(row.difficulty),
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    scopeNodes: row.scopeNodes ?? [], workedExamples: row.features?.workedExamples ?? 0, health: row.health,
    testable: row.envStatus === "green", unreachableReason: row.envStatus === "unreachable" ? row.unreachableReason ?? "can't be run here" : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

// The repo's newest env recipe decides "testable here" and "unreachable".
const RECIPE = sql`left join lateral (
  select status, unreachable_reason from env_recipes where repo_id = r.id
  order by green_at desc nulls last, last_used_at desc nulls last limit 1
) e on true`;

const COLUMNS = sql`i.repo_id as "repoId", r.owner, r.name, r.language, r.health, i.number, i.title, i.labels,
  i.difficulty, i.difficulty_reasons as reasons, i.scope_nodes as "scopeNodes", i.features, i.created_at as "createdAt",
  e.status as "envStatus", e.unreachable_reason as "unreachableReason"`;

/** Open catalog issues nobody has claimed: unassigned, no open PR. */
export async function loadCandidates(db: Db, filter: CandidateFilter = {}): Promise<Candidate[]> {
  const limit = filter.limit ?? 1_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5_000) throw new RangeError("limit must be an integer from 1 to 5000");
  if (filter.repoIds && !filter.repoIds.every(Number.isSafeInteger)) throw new TypeError("repoIds must be integers");
  const where = [
    sql`r.catalog and not r.archived and i.state = 'open'`,
    sql`coalesce((i.features->>'assigned')::boolean, false) = false`,
    sql`coalesce((i.features->>'openPrs')::int, 0) = 0`,
  ];
  if (filter.repoIds) where.push(filter.repoIds.length ? sql`i.repo_id in (${sql.join(filter.repoIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`);
  if (filter.language) where.push(sql`lower(r.language) = ${filter.language.toLowerCase()}`);
  if (filter.maxDifficulty !== undefined) where.push(sql`i.difficulty <= ${filter.maxDifficulty}`);
  if (filter.testableOnly) where.push(sql`e.status = 'green'`);
  // ponytail: newest 1k open issues across the catalog, ranked in memory;
  // push the score into SQL when the catalog outgrows that.
  const rows = rowsOf<CandidateRow>(await db.execute(sql`
    select ${COLUMNS} from issues i join repos r on r.id = i.repo_id ${RECIPE}
    where ${sql.join(where, sql` and `)}
    order by i.created_at desc limit ${sql.raw(String(limit))}`));
  return rows.map(toCandidate);
}

/** Recommendation facts for issues the existing scanners already list, keyed
 *  by issue number; issues outside the index are simply absent. */
export async function issueInsights(db: Db, owner: string, name: string, numbers: number[]): Promise<Map<number, Candidate>> {
  const valid = numbers.filter((number) => Number.isSafeInteger(number) && number > 0);
  if (!valid.length) return new Map();
  const rows = rowsOf<CandidateRow>(await db.execute(sql`
    select ${COLUMNS} from issues i join repos r on r.id = i.repo_id ${RECIPE}
    where lower(r.owner) = ${owner.toLowerCase()} and lower(r.name) = ${name.toLowerCase()}
      and i.number in (${sql.join(valid.map((number) => sql`${number}`), sql`, `)})`));
  return new Map(rows.map((row) => [row.number, toCandidate(row)]));
}

/** The user's GitHub languages: primary languages of repos they've opened PRs
 *  to (the same query as app/api/repos/github), lowercase. */
export async function userLanguages(client: GitHubClient): Promise<string[]> {
  const data = await client.graphql<{ viewer: { repositoriesContributedTo: { nodes: Array<{ primaryLanguage: { name: string } | null }> } } }>(`
    query { viewer { repositoriesContributedTo(first: 100, contributionTypes: [PULL_REQUEST], includeUserRepositories: true, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { primaryLanguage { name } } } } }`);
  return [...new Set(data.viewer.repositoriesContributedTo.nodes.map((repo) => repo.primaryLanguage?.name.toLowerCase()).filter((name): name is string => Boolean(name)))];
}

/** Level, past-lesson languages and map coverage from the database, merged
 *  with the GitHub languages the caller already fetched. */
export async function loadUser(db: Db, userId: string, githubLanguages: string[]): Promise<UserProfile> {
  const [user] = rowsOf<{ level: number }>(await db.execute(sql`select level from users where id = ${userId}`));
  const lessonLanguages = rowsOf<{ language: string }>(await db.execute(sql`
    select distinct lower(r.language) as language from lessons l join repos r on r.id = l.repo_id
    where l.user_id = ${userId} and r.language is not null`)).map((row) => row.language);
  const known = new Map<number, Set<string>>();
  for (const row of rowsOf<{ repoId: number; nodeId: string }>(await db.execute(sql`
    select repo_id as "repoId", node_id as "nodeId" from map_coverage where user_id = ${userId}`))) {
    const set = known.get(row.repoId) ?? new Set<string>();
    set.add(row.nodeId);
    known.set(row.repoId, set);
  }
  return { level: levelName(user?.level), languages: [...new Set([...githubLanguages.map((l) => l.toLowerCase()), ...lessonLanguages])], known };
}

export const FEEDS = ["for-you", "continue", "explore"] as const;
export type Feed = (typeof FEEDS)[number];

export type FeedResult =
  | { feed: "for-you" | "explore"; issues: Ranked[] }
  | { feed: "continue"; repos: Array<{ repo: string; issues: Ranked[] }> };

const NEUTRAL: UserProfile = { level: "Newcomer", languages: [], known: new Map() };

export async function recommend(db: Db, feed: Feed, user: UserProfile, filter: CandidateFilter & { take?: number } = {}): Promise<FeedResult> {
  const take = filter.take ?? 20;
  const byScore = (a: Ranked, b: Ranked) => b.score - a.score || a.repo.localeCompare(b.repo) || a.number - b.number;
  if (feed === "continue") {
    const repoIds = [...user.known.keys()];
    const known = (await loadCandidates(db, { ...filter, repoIds }))
      .map((candidate) => rankCandidate(candidate, user, RANK.knownArea + RANK.continueKnownArea))
      .filter((ranked) => knownArea(ranked, user) > 0)
      .sort(byScore);
    const repos = new Map<string, Ranked[]>();
    for (const ranked of known) repos.set(ranked.repo, [...(repos.get(ranked.repo) ?? []), ranked].slice(0, take));
    return { feed, repos: [...repos].map(([repo, issues]) => ({ repo, issues })) };
  }
  const profile = feed === "explore" ? NEUTRAL : user;
  const ranked = (await loadCandidates(db, filter)).map((candidate) => rankCandidate(candidate, profile)).sort(byScore);
  return { feed, issues: ranked.slice(0, take) };
}

/** What the existing issue lists show when OPENSRCER_RECS is on. */
export type IssueInsight = Pick<Candidate, "difficulty" | "reasons" | "testable" | "unreachableReason" | "workedExamples">;

/** Adds `recs` to every listed issue that is in the catalog index. With the
 *  flag off the list comes back untouched, so the scanners behave as before.
 *  A database failure is logged and also leaves the list untouched: these
 *  facts are extras on a list that works without them. `db` is for tests. */
export async function attachInsights<T extends { number: number }>(
  list: T[], repoOf: (issue: T) => string, db?: Db,
): Promise<Array<T & { recs?: IssueInsight }>> {
  if (!flagEnabled("recs") || !list.length) return list;
  try {
    const database = db ?? await getDb();
    const byRepo = new Map<string, number[]>();
    for (const issue of list) byRepo.set(repoOf(issue), [...(byRepo.get(repoOf(issue)) ?? []), issue.number]);
    const found = new Map<string, Candidate>();
    for (const [repo, numbers] of byRepo) {
      const [owner, name] = repo.split("/");
      if (!owner || !name) continue;
      for (const [number, candidate] of await issueInsights(database, owner, name, numbers)) found.set(`${repo.toLowerCase()}#${number}`, candidate);
    }
    return list.map((issue) => {
      const hit = found.get(`${repoOf(issue).toLowerCase()}#${issue.number}`);
      if (!hit) return issue;
      const { difficulty, reasons, testable, unreachableReason, workedExamples } = hit;
      return { ...issue, recs: { difficulty, reasons, testable, unreachableReason, workedExamples } };
    });
  } catch (error) {
    console.error("[recs] issue insights unavailable:", error instanceof Error ? error.message : error);
    return list;
  }
}
