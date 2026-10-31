// "Import my GitHub history" (PLAN §9.1), opt-in and on request only: the
// user's merged PRs to public repositories, how many repositories they have
// contributed to, and the PRs they opened per day over the last 90 days (the
// spam signal). Imported merges count at half weight and only up to
// Contributor (lib/record/levels.ts). Shown only to the user in this phase.
// Reads only; nothing is posted.

import { and, eq } from "drizzle-orm";
import { splitRepo } from "../ai-policy";
import type { Db } from "../db/client";
import { contributions, repos, users } from "../db/schema";
import { graphqlPaginate, type GitHubClient } from "../gh";
import { spamSignals, SPAM, type OpenedPr, type Signals } from "./signals";
import { appendEvents, assertLogin, ensureRepo, ensureUser, importedPoints, rebuildStanding, type StandingEvent } from "./standing";

export const IMPORT = {
  /** Search pages of 100: GitHub's search stops at 1,000 results anyway. */
  mergedPages: 3,
  openedPages: 10,
} as const;

type SearchPr = { number?: number; createdAt?: string; mergedAt?: string | null; merged?: boolean; repository?: { nameWithOwner: string; isPrivate: boolean } };

const SEARCH = `
  query Search($q: String!, $cursor: String) {
    search(query: $q, type: ISSUE, first: 100, after: $cursor) {
      nodes { ... on PullRequest { number createdAt mergedAt merged repository { nameWithOwner isPrivate } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const CONTRIBUTED = `
  query Contributed($login: String!) {
    user(login: $login) { repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, PULL_REQUEST], includeUserRepositories: false) { totalCount } }
  }`;

export type MergedPr = { repo: string; number: number; createdAt: string; mergedAt: string };
export type History = { merged: MergedPr[]; contributedTo: number; opened: OpenedPr[] };

export class GitHubUserNotFoundError extends Error {
  constructor(login: string) {
    super(`GitHub has no user ${login}`);
    this.name = "GitHubUserNotFoundError";
  }
}

const isPublicPr = (n: SearchPr): n is Required<SearchPr> => typeof n.number === "number" && Boolean(n.repository) && !n.repository!.isPrivate;

/** Read the history from GitHub. */
export async function fetchHistory(client: GitHubClient, login: string, now = new Date()): Promise<History> {
  assertLogin(login);
  const since = new Date(now.getTime() - SPAM.windowDays * 86_400_000).toISOString().slice(0, 10);
  const [merged, contributed, opened] = await Promise.all([
    graphqlPaginate<SearchPr>(client, SEARCH, { q: `is:pr is:merged is:public author:${login}` }, ["search"], IMPORT.mergedPages),
    client.graphql<{ user: { repositoriesContributedTo: { totalCount: number } } | null }>(CONTRIBUTED, { login }),
    graphqlPaginate<SearchPr>(client, SEARCH, { q: `is:pr is:public author:${login} created:>=${since}` }, ["search"], IMPORT.openedPages),
  ]);
  if (!contributed.user) throw new GitHubUserNotFoundError(login);
  return {
    merged: merged.filter(isPublicPr).filter((n) => n.mergedAt).map((n) => ({ repo: n.repository.nameWithOwner, number: n.number, createdAt: n.createdAt, mergedAt: n.mergedAt! })),
    contributedTo: contributed.user.repositoriesContributedTo.totalCount,
    opened: opened.filter(isPublicPr).map((n) => ({ repo: n.repository.nameWithOwner, createdAt: n.createdAt, merged: n.merged })),
  };
}

/** What import keeps on users.settings.history: counts, never PR text. */
export type HistorySummary = { importedAt: string; merged: number; contributedTo: number; mergedPerRepo: Record<string, number>; signals: Signals };

/** The standing events for imported history: half-weight merges (not ones
 *  opensrcer already records) and a spam flag per burst day. Pure. */
export function importEvents(merged: MergedPr[], alreadyRecorded: Set<string>, signals: Signals): StandingEvent[] {
  const events: StandingEvent[] = merged.map((m) => `${m.repo}#${m.number}`).filter((ref) => !alreadyRecorded.has(ref.toLowerCase()))
    .map((ref) => ({ kind: "imported_merged" as const, ref, points: importedPoints() }));
  for (const b of signals.bursts) events.push({ kind: "spam_flag", ref: `burst:${b.day}`, points: 0 });
  return events;
}

/** Import (or re-import) the user's history into their record. */
export async function importHistory(db: Db, client: GitHubClient, user: { id: string; login: string }, now = new Date()): Promise<HistorySummary> {
  assertLogin(user.login);
  const history = await fetchHistory(client, user.login, now);
  history.merged.forEach((m) => splitRepo(m.repo));
  await ensureUser(db, user.id, user.login);

  // PRs opensrcer already records keep their own (full-weight) events.
  const recorded = await db.select({ owner: repos.owner, name: repos.name, number: contributions.prNumber })
    .from(contributions).innerJoin(repos, eq(repos.id, contributions.repoId))
    .where(and(eq(contributions.userId, user.id), eq(contributions.source, "opensrcer")));
  const already = new Set(recorded.map((r) => `${r.owner}/${r.name}#${r.number}`.toLowerCase()));
  const mergedPerRepo: Record<string, number> = {};
  for (const m of history.merged) {
    mergedPerRepo[m.repo] = (mergedPerRepo[m.repo] ?? 0) + 1;
    if (already.has(`${m.repo}#${m.number}`.toLowerCase())) continue;
    await db.insert(contributions).values({
      userId: user.id, repoId: await ensureRepo(db, m.repo), prNumber: m.number, state: "merged",
      openedAt: new Date(m.createdAt), mergedAt: new Date(m.mergedAt), source: "imported",
    }).onConflictDoNothing();
  }
  const signals = spamSignals(history.opened);
  await appendEvents(db, user.id, importEvents(history.merged, already, signals));
  const summary: HistorySummary = { importedAt: now.toISOString(), merged: history.merged.length, contributedTo: history.contributedTo, mergedPerRepo, signals };
  const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, user.id));
  await db.update(users).set({ settings: { ...row.settings, history: summary } }).where(eq(users.id, user.id));
  await rebuildStanding(db, user.id);
  return summary;
}
