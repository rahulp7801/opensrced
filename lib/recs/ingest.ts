// Catalog ingest (PLAN.md §6.1): per catalog repo, by GraphQL, the open issues
// and the issues closed as completed in the last 2 years, each closed one with
// the merged PR that fixed it (files, size, reviews, time to merge). Runs
// nightly from app/api/cron/ingest and by hand from scripts/catalog-add.mjs.
//
// Per repo, in order:
//   1. repo facts + the 50 newest PRs (for repos.health)
//   2. issues updated since the last run (all of them the first time), upserted
//   3. Voyage embeddings for new or edited issues (skipped without a key)
//   4. difficulty v2 for every open issue (age and neighbours change daily)
//   5. repos.health, then ingested_at, so a failed run is retried in full
//   6. with OPENSRCER_RECORD, "you know this code" alerts for issues opened
//      since the last run (lib/record/alerts.ts)
//
// The catalog is repos.catalog = true. Phase 1 will narrow it to repos with a
// green env recipe; until then scripts/catalog-add.mjs marks repos by hand.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { basename } from "node:path/posix";
import type { Db } from "../db/client";
import { issues, repos } from "../db/schema";
import { flagEnabled } from "../flags";
import { graphqlPaginate, type GitHubClient } from "../gh";
import { buildModuleMap, findNode, type GraphData } from "../graph";
import { createAlerts } from "../record/alerts";
import { sanitizeGitHubName } from "../sanitize";
import { classifyScope } from "../scope";
import { contentSignals, graphSignals, scoreDifficulty, type DifficultyFeatures } from "./difficulty";
import { embedTexts, embeddingsEnabled, issueEmbeddingText } from "./embed";
import { firstMaintainerResponseHours, isMaintainer, repoHealth, type PrRecord, type RepoHealth, type ResponseEvent } from "./health";
import { similarIssues, rowsOf } from "./similar";
import { DIFFICULTY } from "./weights";

export const INGEST = {
  /** Issues per GraphQL page; each carries comments, timeline and closing PRs. */
  pageSize: 50,
  /** Pages per state per run: bounds the first ingest of a big repo. Later
   *  runs only fetch what changed. */
  maxPages: 20,
  closedYears: 2,
  /** Re-read this much before the last run, so an edit racing the run is not lost. */
  overlapMinutes: 10,
  bodyChars: 4_000,
  prFiles: 30,
  /** Scope nodes kept per issue, and per touched file. */
  maxScopeNodes: 150,
  nodesPerFile: 25,
} as const;

/** issues.features: the difficulty inputs plus what ranking and health read. */
export type IssueFeatures = DifficultyFeatures & {
  assigned: boolean;
  /** Open pull requests (anyone's) cross-referencing the issue. */
  openPrs: number;
  firstResponseHours: number | null;
  /** Solved neighbours found when difficulty was last computed (open issues). */
  workedExamples?: number;
};

export type IngestResult = {
  repo: string;
  open: number;
  closed: number;
  removed: number;
  embedded: number;
  scored: number;
  health: RepoHealth;
  /** "You know this code" alerts written (lib/record/alerts.ts). */
  alerts: number;
  warnings: string[];
};

type Repo = typeof repos.$inferSelect;
type Event = ResponseEvent;
/** One issue as ISSUES_QUERY returns it. */
export type IssueNode = {
  number: number; title: string; body: string; state: "OPEN" | "CLOSED"; stateReason: string | null;
  createdAt: string; closedAt: string | null; authorAssociation: string; author: { login: string } | null;
  labels: { nodes: Array<{ name: string }> };
  assignees: { totalCount: number };
  participants: { totalCount: number };
  comments: { totalCount: number; nodes: Event[] };
  timelineItems: { nodes: Array<{ source?: { number?: number; state?: string } | null }> };
  closedByPullRequestsReferences: { nodes: Array<{
    number: number; merged: boolean; mergedAt: string | null; createdAt: string;
    additions: number; deletions: number; changedFiles: number;
    repository: { nameWithOwner: string };
    reviews: { totalCount: number }; files: { nodes: Array<{ path: string }> } | null;
  }> };
};

const ISSUES_QUERY = `
  query Issues($owner: String!, $name: String!, $states: [IssueState!], $since: DateTime, $first: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(first: $first, after: $cursor, states: $states, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          number title body state stateReason createdAt closedAt authorAssociation author { login }
          labels(first: 30) { nodes { name } }
          assignees { totalCount }
          participants { totalCount }
          comments(first: 10) { totalCount nodes { createdAt authorAssociation author { login } } }
          timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 30) { nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number state } } } } }
          closedByPullRequestsReferences(first: 3, includeClosedPrs: true) {
            nodes {
              number merged mergedAt createdAt additions deletions changedFiles
              repository { nameWithOwner }
              reviews { totalCount }
              files(first: ${INGEST.prFiles}) { nodes { path } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

type RepoNode = {
  owner: { login: string }; name: string; stargazerCount: number; isArchived: boolean;
  primaryLanguage: { name: string } | null; defaultBranchRef: { name: string } | null;
  pullRequests: { nodes: Array<Omit<PrRecord, "responseHours"> & { comments: { nodes: Event[] }; reviews: { nodes: Event[] } }> };
};

const REPO_QUERY = `
  query Repo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      owner { login } name stargazerCount isArchived primaryLanguage { name } defaultBranchRef { name }
      pullRequests(first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          createdAt mergedAt state authorAssociation author { login }
          comments(first: 5) { nodes { createdAt authorAssociation author { login } } }
          reviews(first: 5) { nodes { createdAt authorAssociation author { login } } }
        }
      }
    }
  }`;

export class RepoNotFoundError extends Error {
  constructor(repo: string) { super(`GitHub repository ${repo} was not found or is not accessible`); this.name = "RepoNotFoundError"; }
}

function splitRepo(fullName: string): [string, string] {
  const [owner, name, extra] = fullName.split("/");
  if (extra !== undefined || !owner || !name || sanitizeGitHubName(owner) !== owner || sanitizeGitHubName(name) !== name) {
    throw new Error(`Expected owner/name, got ${JSON.stringify(fullName)}`);
  }
  return [owner, name];
}

async function fetchRepo(client: GitHubClient, owner: string, name: string): Promise<RepoNode> {
  const data = await client.graphql<{ repository: RepoNode | null }>(REPO_QUERY, { owner, name });
  if (!data.repository) throw new RepoNotFoundError(`${owner}/${name}`);
  return data.repository;
}

const repoFacts = (node: RepoNode) => ({
  owner: node.owner.login, name: node.name, stars: node.stargazerCount, archived: node.isArchived,
  language: node.primaryLanguage?.name ?? null, defaultBranch: node.defaultBranchRef?.name ?? null,
});

/** Marks a repo as part of the catalog, creating its row from GitHub's own
 *  facts (canonical owner/name case, language, stars). Idempotent. */
export async function addToCatalog(db: Db, client: GitHubClient, fullName: string): Promise<Repo> {
  const [owner, name] = splitRepo(fullName);
  const facts = repoFacts(await fetchRepo(client, owner, name));
  const [row] = await db.insert(repos).values({ ...facts, catalog: true })
    .onConflictDoUpdate({ target: [repos.owner, repos.name], set: { ...facts, catalog: true, updatedAt: sql`now()` } })
    .returning();
  return row;
}

// ── Mapping issues onto the graph ─────────────────────────────────────

type GraphContext = { graph: GraphData; byFile: Map<string, string[]>; fanIn: Map<string, number>; modules: Map<number, string> };

export function graphContext(graph: GraphData): GraphContext {
  const byFile = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.source_file || /rationale/.test(node.id)) continue;
    const key = node.source_file.replace(/\\/g, "/").toLowerCase();
    const list = byFile.get(key) ?? [];
    if (list.length < INGEST.nodesPerFile) list.push(node.id);
    byFile.set(key, list);
  }
  return { graph, byFile, fanIn: new Map(), modules: buildModuleMap(graph) };
}

function nodesInFile(context: GraphContext, path: string): string[] {
  const key = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const exact = context.byFile.get(key);
  if (exact) return exact;
  // Issue text often names a file without its directory ("core.py").
  for (const [file, ids] of context.byFile) if (file.endsWith(`/${key}`)) return ids;
  return [];
}

/** §6.1 "Map to the graph": classifyScope's paths and symbols through findNode,
 *  plus the fixing PR's files. Node ids when the repo has a shared graph, and
 *  always `file:<basename>` tokens, so overlap works before a graph exists.
 *  `textNodes` are the nodes the issue text alone points at (graph features). */
export function scopeNodesFor(title: string, body: string, prFiles: string[], context: GraphContext | null): { scopeNodes: string[]; textNodes: string[] } {
  const scope = classifyScope(title, body);
  const textNodes = new Set<string>();
  const prNodes = new Set<string>();
  if (context) {
    for (const file of scope.files) for (const id of nodesInFile(context, file)) textNodes.add(id);
    for (const symbol of scope.symbols) {
      const node = findNode(context.graph, symbol);
      if (node && !/rationale/.test(node.id)) textNodes.add(node.id);
    }
    for (const file of prFiles) for (const id of nodesInFile(context, file)) prNodes.add(id);
  }
  const files = [...scope.files, ...prFiles].map((file) => `file:${basename(file.replace(/\\/g, "/")).toLowerCase()}`);
  return { scopeNodes: [...new Set([...textNodes, ...prNodes, ...files])].slice(0, INGEST.maxScopeNodes), textNodes: [...textNodes] };
}

// ── Issues ────────────────────────────────────────────────────────────

const HOUR = 3_600_000;

export type MappedIssue = {
  row: typeof issues.$inferInsert;
  /** Closed, but not as completed: dropped from the index. */
  drop: boolean;
};

/** One GraphQL issue → an issues row. Exported for tests. */
export function mapIssue(node: IssueNode, repo: Pick<Repo, "id" | "owner" | "name" | "stars">, context: GraphContext | null): MappedIssue {
  const body = node.body ?? "";
  const closed = node.state === "CLOSED";
  // Before GitHub recorded a reason, "closed" meant completed.
  const drop = closed && node.stateReason !== null && node.stateReason !== "COMPLETED";
  const fullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const fix = closed ? node.closedByPullRequestsReferences.nodes.find((pr) => pr.merged && pr.mergedAt && pr.repository.nameWithOwner.toLowerCase() === fullName) : undefined;
  const prFiles = fix?.files?.nodes.map((file) => file.path) ?? [];
  const { scopeNodes, textNodes } = scopeNodesFor(node.title, body, prFiles, context);
  const linked = node.timelineItems.nodes.map((item) => item.source).filter((source) => source?.number);
  const states = (state: string) => new Set(linked.filter((source) => source!.state === state).map((source) => source!.number)).size;
  const features: IssueFeatures = {
    ...contentSignals(body),
    labels: node.labels.nodes.map((label) => label.name.toLowerCase()),
    reporterIsMaintainer: isMaintainer(node.authorAssociation),
    repoStars: repo.stars,
    comments: node.comments.totalCount,
    participants: node.participants.totalCount,
    attempts: states("CLOSED"),
    graph: context && textNodes.length ? graphSignals(context.graph, textNodes, context.fanIn, context.modules) : null,
    assigned: node.assignees.totalCount > 0,
    openPrs: states("OPEN"),
    firstResponseHours: firstMaintainerResponseHours(node.createdAt, node.author?.login, node.comments.nodes),
  };
  return {
    drop,
    row: {
      repoId: repo.id, number: node.number, title: node.title, bodyExcerpt: body.slice(0, INGEST.bodyChars),
      labels: features.labels, state: closed ? "closed" : "open",
      createdAt: new Date(node.createdAt), closedAt: node.closedAt ? new Date(node.closedAt) : null,
      authorAssoc: node.authorAssociation, comments: node.comments.totalCount,
      closingPr: fix?.number ?? null, fixFiles: fix?.changedFiles ?? null, fixAdd: fix?.additions ?? null, fixDel: fix?.deletions ?? null,
      reviewRounds: fix ? fix.reviews.totalCount : null,
      mergeHours: fix ? Math.round((Date.parse(fix.mergedAt!) - Date.parse(fix.createdAt)) / HOUR) : null,
      scopeNodes, features,
    },
  };
}

async function upsertIssues(db: Db, rows: Array<typeof issues.$inferInsert>): Promise<void> {
  const excluded = (column: string) => sql.raw(`excluded.${column}`);
  for (let start = 0; start < rows.length; start += 100) {
    await db.insert(issues).values(rows.slice(start, start + 100)).onConflictDoUpdate({
      target: [issues.repoId, issues.number],
      set: {
        title: excluded("title"), bodyExcerpt: excluded("body_excerpt"), labels: excluded("labels"), state: excluded("state"),
        closedAt: excluded("closed_at"), authorAssoc: excluded("author_assoc"), comments: excluded("comments"),
        closingPr: excluded("closing_pr"), fixFiles: excluded("fix_files"), fixAdd: excluded("fix_add"), fixDel: excluded("fix_del"),
        reviewRounds: excluded("review_rounds"), mergeHours: excluded("merge_hours"),
        scopeNodes: excluded("scope_nodes"), features: excluded("features"),
        // An edited issue is re-embedded; an unchanged one keeps its vector.
        embedding: sql`case when issues.title = excluded.title and issues.body_excerpt = excluded.body_excerpt then issues.embedding else null end`,
      },
    });
  }
}

async function embedMissing(db: Db, repoId: number, fetchImpl?: typeof fetch): Promise<number> {
  const missing = await db.select({ number: issues.number, title: issues.title, body: issues.bodyExcerpt })
    .from(issues).where(and(eq(issues.repoId, repoId), isNull(issues.embedding)));
  if (!missing.length) return 0;
  const vectors = await embedTexts(missing.map((issue) => issueEmbeddingText(issue.title, issue.body)), { fetch: fetchImpl });
  for (let i = 0; i < missing.length; i++) {
    await db.update(issues).set({ embedding: vectors[i] }).where(and(eq(issues.repoId, repoId), eq(issues.number, missing[i].number)));
  }
  return missing.length;
}

/** Difficulty v2 for every open issue in the repo. Open issues only: closed
 *  ones are never shown, and calibration recomputes them leave-one-out. */
export async function scoreOpenIssues(db: Db, repo: Pick<Repo, "id" | "language">, now = new Date()): Promise<number> {
  const open = await db.select().from(issues).where(and(eq(issues.repoId, repo.id), eq(issues.state, "open")));
  let scored = 0;
  for (const issue of open) {
    const features = issue.features as IssueFeatures | null;
    if (!features) continue;
    const neighbours = await similarIssues(db, {
      repoId: repo.id, number: issue.number, language: repo.language, title: issue.title, body: issue.bodyExcerpt,
      embedding: issue.embedding, scopeNodes: issue.scopeNodes ?? [],
    }, { limit: DIFFICULTY.neighbours });
    const ageDays = (now.getTime() - issue.createdAt.getTime()) / (24 * HOUR);
    const { difficulty, reasons } = scoreDifficulty(features, ageDays, neighbours);
    await db.update(issues).set({ difficulty, difficultyReasons: reasons, features: { ...features, workedExamples: neighbours.length } })
      .where(and(eq(issues.repoId, repo.id), eq(issues.number, issue.number)));
    scored++;
  }
  return scored;
}

async function issueResponseHours(db: Db, repoId: number, now: Date): Promise<number[]> {
  const since = new Date(now.getTime() - 365 * 24 * HOUR).toISOString();
  const rows = rowsOf<{ hours: number }>(await db.execute(sql`
    select (features->>'firstResponseHours')::float8 as hours from issues
    where repo_id = ${repoId} and created_at >= ${since}::timestamptz
      and features->>'firstResponseHours' is not null and features->>'reporterIsMaintainer' = 'false'`));
  return rows.map((row) => Number(row.hours));
}

export type IngestOptions = {
  now?: Date;
  /** The repo's code graph, or null; defaults to its shared graph (lib/graph-store.ts). */
  loadGraph?: (repo: string) => Promise<GraphData | null>;
  /** Voyage's fetch, for tests. Embedding runs only when embeddingsEnabled(). */
  embedFetch?: typeof fetch;
  /** Write "you know this code" alerts; defaults to OPENSRCER_RECORD. */
  alerts?: boolean;
};

async function sharedGraph(repo: string): Promise<GraphData | null> {
  // Imported lazily: graph-store pulls in Blob, which tests never need.
  const { getSharedGraph } = await import("../graph-store");
  return (await getSharedGraph(repo))?.graph ?? null;
}

export async function ingestRepo(db: Db, client: GitHubClient, repo: Repo, options: IngestOptions = {}): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const meta = await fetchRepo(client, repo.owner, repo.name);
  const [current] = await db.update(repos).set({ ...repoFacts(meta), updatedAt: now }).where(eq(repos.id, repo.id)).returning();
  const fullName = `${current.owner}/${current.name}`;

  let context: GraphContext | null = null;
  try {
    const graph = await (options.loadGraph ?? sharedGraph)(fullName);
    context = graph ? graphContext(graph) : null;
  } catch (error) {
    // A broken graph costs the graph features, not the night's ingest; say so.
    warnings.push(`graph unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const since = current.ingestedAt ? new Date(current.ingestedAt.getTime() - INGEST.overlapMinutes * 60_000) : null;
  const twoYears = new Date(now.getTime() - INGEST.closedYears * 365 * 24 * HOUR);
  const closedSince = since && since > twoYears ? since : twoYears;
  const fetchIssues = (states: string[], from: Date | null) => graphqlPaginate<IssueNode>(client, ISSUES_QUERY,
    { owner: current.owner, name: current.name, states, since: from?.toISOString() ?? null, first: INGEST.pageSize },
    ["repository", "issues"], INGEST.maxPages);
  const [openNodes, closedNodes] = [await fetchIssues(["OPEN"], since), await fetchIssues(["CLOSED"], closedSince)];

  const mapped = [...openNodes, ...closedNodes].map((node) => mapIssue(node, current, context));
  const keep = mapped.filter((item) => !item.drop).map((item) => item.row);
  const dropped = mapped.filter((item) => item.drop).map((item) => item.row.number);
  await upsertIssues(db, keep);
  if (dropped.length) await db.delete(issues).where(and(eq(issues.repoId, current.id), inArray(issues.number, dropped)));

  const embedded = embeddingsEnabled() ? await embedMissing(db, current.id, options.embedFetch) : 0;
  const scored = await scoreOpenIssues(db, current, now);

  const prs: PrRecord[] = meta.pullRequests.nodes.map((pr) => ({
    createdAt: pr.createdAt, mergedAt: pr.mergedAt, state: pr.state, authorAssociation: pr.authorAssociation, author: pr.author,
    responseHours: firstMaintainerResponseHours(pr.createdAt, pr.author?.login, [...pr.comments.nodes, ...pr.reviews.nodes]),
  }));
  const health = repoHealth(await issueResponseHours(db, current.id, now), prs, now);
  await db.update(repos).set({ health, ingestedAt: now }).where(eq(repos.id, current.id));

  // Only issues opened since the last run are new; a repo's first ingest
  // alerts nobody, or its whole backlog would arrive at once.
  let alerted = 0;
  if ((options.alerts ?? flagEnabled("record")) && since) {
    const fresh = keep.filter((row) => row.state === "open" && row.createdAt && row.createdAt >= since
      && !(row.features as IssueFeatures).assigned && (row.features as IssueFeatures).openPrs === 0);
    alerted = await createAlerts(db, current.id, fresh.map((row) => ({ number: row.number, scopeNodes: row.scopeNodes ?? [] })), context?.graph ?? null, now);
  }

  return {
    repo: fullName, open: openNodes.length, closed: keep.length - openNodes.length, removed: dropped.length,
    embedded, scored, health, alerts: alerted, warnings,
  };
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Unset or short
 *  secrets refuse everything rather than leaving the route open. */
export function cronAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CatalogRun ={ results: IngestResult[]; failed: Array<{ repo: string; error: string }>; remaining: number };

/** Every catalog repo, least recently ingested first, until `deadline`. A repo
 *  that fails is reported and the rest still run. */
export async function ingestCatalog(db: Db, client: GitHubClient, deadline: number, options: IngestOptions = {}): Promise<CatalogRun> {
  const catalog = await db.select().from(repos).where(and(eq(repos.catalog, true), eq(repos.archived, false)))
    .orderBy(sql`${repos.ingestedAt} asc nulls first`);
  const run: CatalogRun = { results: [], failed: [], remaining: 0 };
  for (const [index, repo] of catalog.entries()) {
    // ponytail: one repo at a time inside one function call; a catalog that
    // outgrows the cron window continues tomorrow (oldest first), so move to
    // a queue only if `remaining` stays above zero night after night.
    if (Date.now() >= deadline) { run.remaining = catalog.length - index; break; }
    try {
      run.results.push(await ingestRepo(db, client, repo, options));
    } catch (error) {
      run.failed.push({ repo: `${repo.owner}/${repo.name}`, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return run;
}
