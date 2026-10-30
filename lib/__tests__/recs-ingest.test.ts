// Ingest against real GraphQL responses from python-attrs/attrs (fixture
// fetched with the ingest's own queries), into PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { EMBEDDING_DIMENSIONS, issues, repos } from "../db/schema";
import { gh } from "../gh";
import type { GraphData } from "../graph";
import { addToCatalog, cronAuthorized, graphContext, ingestCatalog, ingestRepo, mapIssue, scopeNodesFor, type IssueFeatures, type IssueNode } from "../recs/ingest";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "lib/__tests__/fixtures/recs-attrs-graphql.json"), "utf8"));
const NOW = new Date("2026-10-29T12:00:00Z");

type Request = { query: string; variables: Record<string, unknown> };

/** GitHub's GraphQL endpoint, answering from the fixture. */
function fakeGitHub(options: { missing?: boolean } = {}) {
  const requests: Request[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as Request;
    requests.push(request);
    let body: unknown;
    if (options.missing) body = { data: { repository: null } };
    else if (request.query.includes("query Repo(")) body = fixture.repo;
    else if (request.query.includes("query Issues(")) body = (request.variables.states as string[])[0] === "OPEN" ? fixture.open : fixture.closed;
    else throw new Error("unexpected query");
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { client: gh(`t-${Math.random()}`, { fetch }), requests };
}

/** A tiny graph of attrs: _make.py holds the code most fixes touch. */
const graph: GraphData = {
  nodes: [
    { id: "make_attrs", label: "_make_attrs()", community: 0, file_type: "code", source_file: "src/attr/_make.py" },
    { id: "make_file", label: "_make.py", community: 0, file_type: "code", source_file: "src/attr/_make.py" },
    { id: "init_pyi", label: "__init__.pyi", community: 1, file_type: "code", source_file: "src/attr/__init__.pyi" },
    { id: "note_rationale_1", label: "why", community: 0, file_type: "code", source_file: "src/attr/_make.py" },
  ],
  links: [],
};

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => { process.env = saved; });
}

test("cronAuthorized: exact bearer secret only; unset or short secrets refuse", () => {
  const secret = "s".repeat(32);
  assert.equal(cronAuthorized(`Bearer ${secret}`, secret), true);
  for (const header of [null, "", secret, `Bearer ${secret}x`, `bearer ${secret}`]) assert.equal(cronAuthorized(header, secret), false, String(header));
  assert.equal(cronAuthorized("Bearer short", "short"), false);
  assert.equal(cronAuthorized("Bearer ", ""), false);
  assert.equal(cronAuthorized("Bearer x", undefined), false);
});

test("scopeNodesFor: graph nodes from text and PR files, plus file tokens, never rationale nodes", () => {
  const context = graphContext(graph);
  const { scopeNodes, textNodes } = scopeNodesFor("Bug in _make_attrs", "See `_make.py`", ["src/attr/__init__.pyi"], context);
  assert.deepEqual(textNodes.sort(), ["make_attrs", "make_file"]);
  assert.ok(scopeNodes.includes("init_pyi"));
  assert.ok(scopeNodes.includes("file:_make.py") && scopeNodes.includes("file:__init__.pyi"));
  assert.ok(!scopeNodes.includes("note_rationale_1"));
  // Without a graph only the file tokens remain.
  assert.deepEqual(scopeNodesFor("t", "See `_make.py`", ["docs/api.rst"], null).scopeNodes, ["file:_make.py", "file:api.rst"]);
});

test("mapIssue: merged same-repo fix, unmerged fix, duplicate dropped", () => {
  const repo = { id: 1, owner: "python-attrs", name: "attrs", stars: 5_800 };
  const nodes = fixture.closed.data.repository.issues.nodes as IssueNode[];
  const byNumber = new Map(nodes.map((node) => [node.number, node] as const));
  const get = (number: number) => byNumber.get(number)!;
  const merged = mapIssue(get(1575), repo, null);
  assert.deepEqual(
    { closingPr: merged.row.closingPr, fixFiles: merged.row.fixFiles, fixAdd: merged.row.fixAdd, fixDel: merged.row.fixDel, reviewRounds: merged.row.reviewRounds, mergeHours: merged.row.mergeHours, drop: merged.drop },
    { closingPr: 1593, fixFiles: 3, fixAdd: 20, fixDel: 0, reviewRounds: 1, mergeHours: 294, drop: false },
  );
  assert.ok(merged.row.scopeNodes!.includes("file:_make.py"));
  const unmerged = mapIssue(get(1540), repo, null);
  assert.equal(unmerged.row.closingPr, null);
  assert.equal((unmerged.row.features as IssueFeatures).attempts, 1);
  assert.equal(mapIssue(get(1531), repo, null).drop, true);
  // The same PR in a fork doesn't count as this repo's fix.
  const elsewhere = mapIssue(get(1575), { ...repo, owner: "someone-else" }, null);
  assert.equal(elsewhere.row.closingPr, null);
});

test("addToCatalog: canonical names from GitHub, idempotent; bad names and missing repos throw", async () => {
  const { client } = fakeGitHub();
  const first = await addToCatalog(connection.db, client, "python-attrs/attrs");
  const again = await addToCatalog(connection.db, client, "python-attrs/attrs");
  assert.equal(first.id, again.id);
  assert.deepEqual({ owner: first.owner, name: first.name, catalog: first.catalog, language: first.language }, { owner: "python-attrs", name: "attrs", catalog: true, language: "Python" });
  assert.ok(first.stars > 1000);
  for (const bad of ["attrs", "a/b/c", "a b/c", "../x"]) await assert.rejects(addToCatalog(connection.db, client, bad), /Expected owner\/name/);
  await assert.rejects(addToCatalog(connection.db, fakeGitHub({ missing: true }).client, "nobody/nothing"), /not found/);
});

test("ingestRepo: issues, fixes, difficulty, health; then incremental and embedded", async () => {
  const { db } = connection;
  const [repo] = await db.select().from(repos).where(eq(repos.name, "attrs"));
  const { client, requests } = fakeGitHub();

  const result = await withEnv({ VOYAGE_API_KEY: undefined }, () => ingestRepo(db, client, repo, { now: NOW, loadGraph: async () => graph }));
  assert.deepEqual({ open: result.open, closed: result.closed, removed: result.removed, embedded: result.embedded, scored: result.scored },
    { open: 3, closed: 7, removed: 1, embedded: 0, scored: 3 });
  assert.deepEqual(result.warnings, []);
  // First run: open issues from the beginning, closed ones from 2 years back.
  const issueRequests = requests.filter((r) => r.query.includes("query Issues("));
  assert.equal(issueRequests[0].variables.since, null);
  assert.equal(issueRequests[1].variables.since, "2024-10-29T12:00:00.000Z");

  const rows = await db.select().from(issues).where(eq(issues.repoId, repo.id));
  assert.equal(rows.length, 10);
  assert.ok(!rows.some((row) => row.number === 1531), "closed as duplicate is not indexed");
  const fixed = rows.find((row) => row.number === 1400)!;
  assert.deepEqual([fixed.closingPr, fixed.fixFiles, fixed.fixAdd, fixed.fixDel], [1529, 6, 37, 11]);
  assert.ok(fixed.scopeNodes!.includes("make_attrs") && fixed.scopeNodes!.includes("init_pyi"));
  assert.ok(fixed.tsv, "full-text vector generated");
  for (const open of rows.filter((row) => row.state === "open")) {
    assert.ok(open.difficulty! >= 1 && open.difficulty! <= 5, `#${open.number} difficulty`);
    assert.ok(Array.isArray(open.difficultyReasons));
    const features = open.features as IssueFeatures;
    assert.ok(features.openPrs > 0, "every open fixture issue already has an open PR");
    assert.equal(typeof features.workedExamples, "number");
  }
  assert.equal(rows.find((row) => row.number === 753)!.bodyExcerpt.length <= 4_000, true);

  const [after] = await db.select().from(repos).where(eq(repos.id, repo.id));
  assert.equal(after.ingestedAt?.toISOString(), NOW.toISOString());
  assert.equal((after.health as { sample: { prs: number } }).sample.prs, 12);

  // Second run with a Voyage key: incremental, and every issue gets a vector once.
  const voyageCalls: number[] = [];
  const voyage = (async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(String(init.body)) as { input: string[] };
    voyageCalls.push(input.length);
    return Response.json({ data: input.map((_, index) => ({ index, embedding: new Array(EMBEDDING_DIMENSIONS).fill(0).map((_, i) => (i === index ? 1 : 0)) })) });
  }) as unknown as typeof fetch;
  const later = new Date(NOW.getTime() + 86_400_000);
  const second = fakeGitHub();
  const rerun = await withEnv({ VOYAGE_API_KEY: "pa-test" }, () => ingestRepo(db, second.client, after, { now: later, loadGraph: async () => graph, embedFetch: voyage }));
  assert.equal(rerun.embedded, 10);
  assert.deepEqual(voyageCalls, [10]);
  assert.equal(second.requests.filter((r) => r.query.includes("query Issues("))[0].variables.since, "2026-10-29T11:50:00.000Z");
  const [embedded] = await db.select().from(issues).where(and(eq(issues.repoId, repo.id), eq(issues.number, 1575)));
  assert.equal(embedded.embedding?.length, EMBEDDING_DIMENSIONS);

  // Unchanged text keeps its vector: a third run embeds nothing.
  const third = await withEnv({ VOYAGE_API_KEY: "pa-test" }, () => ingestRepo(db, fakeGitHub().client, after, { now: later, loadGraph: async () => graph, embedFetch: voyage }));
  assert.equal(third.embedded, 0);
});

test("ingestRepo: a broken graph is a warning, not a failed ingest", async () => {
  const [repo] = await connection.db.select().from(repos).where(eq(repos.name, "attrs"));
  const result = await withEnv({ VOYAGE_API_KEY: undefined }, () =>
    ingestRepo(connection.db, fakeGitHub().client, repo, { now: NOW, loadGraph: async () => { throw new Error("corrupt"); } }));
  assert.deepEqual(result.warnings, ["graph unavailable: corrupt"]);
});

test("ingestCatalog: catalog repos only, failures reported, deadline respected", async () => {
  const { db } = connection;
  await db.insert(repos).values([
    { owner: "gone", name: "repo", catalog: true },
    { owner: "not", name: "catalog", catalog: false },
    { owner: "old", name: "archived", catalog: true, archived: true },
  ]);
  // The fake answers every repo with attrs' data, so "gone/repo" would
  // ingest; a client that says "not found" for it shows the failure path.
  const missing = fakeGitHub({ missing: true });
  const run = await withEnv({ VOYAGE_API_KEY: undefined }, () => ingestCatalog(db, missing.client, Date.now() + 60_000, { loadGraph: async () => null }));
  assert.deepEqual(run.failed.map((f) => f.repo).sort(), ["gone/repo", "python-attrs/attrs"]);
  assert.equal(run.results.length, 0);
  assert.ok(run.failed.every((f) => /not found/.test(f.error)));

  const late = await ingestCatalog(db, missing.client, Date.now() - 1);
  assert.deepEqual([late.results.length, late.failed.length, late.remaining], [0, 0, 2]);
});
