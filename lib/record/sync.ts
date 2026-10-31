// Contribution sync (PLAN §9.1). opensrcer PRs are recorded when they are
// published (recordPublished); the nightly cron (app/api/cron/record) then
// refreshes every open one from GitHub: open/merged/closed, review rounds,
// APPROVED reviews by the project's own people, and whether the author
// replied to every review thread. Each change becomes standing events
// (lib/record/standing.ts), and the touched users' levels are rebuilt.
// Reads only; nothing is posted.

import { and, eq, ne } from "drizzle-orm";
import { splitRepo } from "../ai-policy";
import type { TimelineEvent } from "../contrib-guard";
import type { Db } from "../db/client";
import { contributions, repos, users } from "../db/schema";
import type { GitHubClient } from "../gh";
import { closingObjection } from "./signals";
import { appendEvents, ensureRepo, ensureUser, mergedPoints, POINTS, rebuildStanding, type StandingEvent } from "./standing";

export const SYNC = {
  /** PRs per GraphQL request (aliased). */
  batch: 20,
  reviews: 50,
  threads: 50,
  threadComments: 20,
  /** The newest PR comments read for a maintainer's closing objection. */
  comments: 30,
} as const;

const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

type Login = { login: string } | null;
export type PrNode = {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: string | null;
  author: Login;
  reviews: { nodes: Array<{ state: string; authorAssociation: string; author: Login }> };
  reviewThreads: { nodes: Array<{ comments: { nodes: Array<{ author: Login }> } }> };
  comments: { nodes: Array<{ body: string; authorAssociation: string; author: Login; url: string }> };
};

export type PrOutcome = {
  state: "open" | "merged" | "closed";
  mergedAt: Date | null;
  /** Reviews by others that asked for changes or commented. */
  reviewRounds: number;
  approvedByMaintainer: boolean;
  /** Someone else reviewed (a review or a review thread). */
  reviewed: boolean;
  /** The author replied in every review thread someone else started. */
  respondedToReview: boolean;
  /** Closed with a maintainer calling it AI-written or spam: their sentence. */
  objection: string | null;
};

const same = (a: Login, login: string) => a?.login?.toLowerCase() === login.toLowerCase();

/** What a PR's GitHub state means for the record. Pure. */
export function prOutcome(pr: PrNode, login: string): PrOutcome {
  const others = pr.reviews.nodes.filter((r) => !same(r.author, login));
  const threads = pr.reviewThreads.nodes.filter((t) => t.comments.nodes.length && !same(t.comments.nodes[0].author, login));
  const state = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open";
  const comments: TimelineEvent[] = pr.comments.nodes.map((c) => ({ event: "commented", body: c.body, author_association: c.authorAssociation, user: c.author, html_url: c.url }));
  return {
    state,
    mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
    reviewRounds: others.filter((r) => r.state === "CHANGES_REQUESTED" || r.state === "COMMENTED").length,
    approvedByMaintainer: others.some((r) => r.state === "APPROVED" && MAINTAINER.has(r.authorAssociation)),
    reviewed: others.length > 0 || threads.length > 0,
    // ponytail: review threads only; a review with just a body counts as answered.
    respondedToReview: threads.every((t) => t.comments.nodes.slice(1).some((c) => same(c.author, login))),
    objection: state === "closed" ? closingObjection(comments) : null,
  };
}

/** The standing events an outcome earns. `earlierMergedInRepo` counts the
 *  user's other merged opensrcer PRs in the same repository. Pure. */
export function outcomeEvents(ref: string, pathB: boolean, o: PrOutcome, earlierMergedInRepo: number): StandingEvent[] {
  const events: StandingEvent[] = [];
  if (o.state === "merged") events.push({ kind: pathB ? "merged_self" : "merged", ref, points: mergedPoints(pathB, earlierMergedInRepo) });
  if (o.approvedByMaintainer) events.push({ kind: "approval", ref, points: POINTS.approval });
  if (o.state !== "open" && o.reviewed) {
    if (!o.respondedToReview) events.push({ kind: "review_unanswered", ref, points: 0 });
    else if (o.state === "merged") events.push({ kind: "review_replied", ref, points: POINTS.reviewReplied });
  }
  if (o.objection) events.push({ kind: "spam_flag", ref: `objection:${ref}`, points: 0 });
  return events;
}

const PR_FIELDS = `
  state mergedAt author { login }
  reviews(first: ${SYNC.reviews}) { nodes { state authorAssociation author { login } } }
  reviewThreads(first: ${SYNC.threads}) { nodes { comments(first: ${SYNC.threadComments}) { nodes { author { login } } } } }
  comments(last: ${SYNC.comments}) { nodes { body authorAssociation author { login } url } }`;

/** Many PRs in one GraphQL request. A missing PR (deleted repo) comes back null. */
async function fetchPrs(client: GitHubClient, prs: Array<{ owner: string; name: string; number: number }>): Promise<Array<PrNode | null>> {
  const vars: Record<string, unknown> = {};
  const decls: string[] = [];
  const parts = prs.map((pr, i) => {
    vars[`o${i}`] = pr.owner; vars[`n${i}`] = pr.name; vars[`p${i}`] = pr.number;
    decls.push(`$o${i}: String!, $n${i}: String!, $p${i}: Int!`);
    return `r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { ${PR_FIELDS} } }`;
  });
  const data = await client.graphql<Record<string, { pullRequest: PrNode | null } | null>>(`query Prs(${decls.join(", ")}) { ${parts.join("\n")} }`, vars);
  return prs.map((_, i) => data[`r${i}`]?.pullRequest ?? null);
}

export type SyncRun = { checked: number; changed: number; missing: string[]; users: number };

/** Refresh every open opensrcer contribution. Stops starting batches at `deadline` (ms epoch). */
export async function syncContributions(db: Db, client: GitHubClient, deadline = Infinity): Promise<SyncRun> {
  const open = await db.select({
    id: contributions.id, userId: contributions.userId, repoId: contributions.repoId, number: contributions.prNumber, path: contributions.path,
    login: users.login, owner: repos.owner, name: repos.name,
  }).from(contributions).innerJoin(users, eq(users.id, contributions.userId)).innerJoin(repos, eq(repos.id, contributions.repoId))
    .where(and(eq(contributions.state, "open"), eq(contributions.source, "opensrcer"))).orderBy(contributions.id);
  const run: SyncRun = { checked: 0, changed: 0, missing: [], users: 0 };
  const touched = new Set<string>();
  for (let start = 0; start < open.length && Date.now() < deadline; start += SYNC.batch) {
    const batch = open.slice(start, start + SYNC.batch);
    const nodes = await fetchPrs(client, batch);
    for (const [i, c] of batch.entries()) {
      const ref = `${c.owner}/${c.name}#${c.number}`;
      run.checked++;
      const node = nodes[i];
      if (!node) { run.missing.push(ref); continue; }
      const o = prOutcome(node, c.login);
      await db.update(contributions).set({
        state: o.state, mergedAt: o.mergedAt, reviewRounds: o.reviewRounds,
        approvedByMaintainer: o.approvedByMaintainer, respondedToReview: o.respondedToReview,
      }).where(eq(contributions.id, c.id));
      const earlier = o.state === "merged"
        ? (await db.select({ id: contributions.id }).from(contributions).where(and(
          eq(contributions.userId, c.userId), eq(contributions.repoId, c.repoId), eq(contributions.state, "merged"),
          eq(contributions.source, "opensrcer"), ne(contributions.id, c.id)))).length
        : 0;
      if (await appendEvents(db, c.userId, outcomeEvents(ref, c.path === "self", o, earlier))) touched.add(c.userId);
      if (o.state !== "open") run.changed++;
    }
  }
  for (const userId of touched) await rebuildStanding(db, userId);
  run.users = touched.size;
  return run;
}

export class InvalidContributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContributionError";
  }
}

export type PublishedPr = { userId: string; login: string; repoFull: string; prNumber: number; path: "ai" | "self"; openedAt?: Date };

/** Record a PR opensrcer just published (state open; the sync takes it from there). Idempotent. */
export async function recordPublished(db: Db, pr: PublishedPr): Promise<void> {
  if (!Number.isSafeInteger(pr.prNumber) || pr.prNumber < 1) throw new InvalidContributionError(`Not a PR number: ${pr.prNumber}`);
  if (pr.path !== "ai" && pr.path !== "self") throw new InvalidContributionError(`Unknown path: ${String(pr.path)}`);
  splitRepo(pr.repoFull); // InvalidRepoNameError before anything is written
  await ensureUser(db, pr.userId, pr.login);
  const repoId = await ensureRepo(db, pr.repoFull);
  await db.insert(contributions).values({
    userId: pr.userId, repoId, prNumber: pr.prNumber, path: pr.path, state: "open", openedAt: pr.openedAt ?? new Date(), source: "opensrcer",
  }).onConflictDoNothing();
}
