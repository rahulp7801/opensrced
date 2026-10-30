import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { envRecipes, issues, mapCoverage, repos, users } from "../db/schema";
import { gh } from "../gh";
import {
  attachInsights, fit, issueInsights, knownArea, levelName, loadCandidates, loadUser, rankCandidate, recommend, userLanguages,
  type Candidate, type UserProfile,
} from "../recs/rank";

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  repoId: 1, repo: "pallets/click", language: "Python", number: 1, title: "t", url: "u", labels: [], difficulty: 2, reasons: [],
  scopeNodes: [], workedExamples: 0, health: null, testable: false, unreachableReason: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
});
const newcomer: UserProfile = { level: "Newcomer", languages: [], known: new Map() };

test("levelName: 0 is Newcomer, clamps out-of-range values", () => {
  assert.deepEqual([0, 1, 2, 3, 9, -1, null, undefined, 1.7].map(levelName),
    ["Newcomer", "Contributor", "Regular", "Trusted", "Trusted", "Newcomer", "Newcomer", "Newcomer", "Contributor"]);
});

test("fit: full inside the level's range, half one step out, none beyond", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((d) => fit("Newcomer", d)), [1, 1, 0.5, 0, 0]);
  assert.deepEqual([1, 2, 3, 4, 5].map((d) => fit("Regular", d)), [0, 0.5, 1, 1, 0.5]);
});

test("knownArea: share of the issue's graph nodes the user knows; file tokens don't count", () => {
  const user: UserProfile = { ...newcomer, known: new Map([[1, new Set(["a", "b"])]]) };
  assert.equal(knownArea(candidate({ scopeNodes: ["a", "c", "file:x.py"] }), user), 0.5);
  assert.equal(knownArea(candidate({ repoId: 2, scopeNodes: ["a"] }), user), 0);
  assert.equal(knownArea(candidate({ scopeNodes: ["file:x.py"] }), user), 0);
  assert.equal(knownArea(candidate({ scopeNodes: ["a"] }), newcomer), 0);
});

test("rankCandidate: each §6.4 term moves the score and says why", () => {
  assert.equal(rankCandidate(candidate(), newcomer).score, 1.1); // fit 1 + neutral responsiveness 0.5 × 0.2
  const user: UserProfile = { level: "Newcomer", languages: ["python"], known: new Map([[1, new Set(["a"])]]) };
  const best = rankCandidate(candidate({ scopeNodes: ["a"], workedExamples: 2, health: { issueResponseHours: 5 } }), user);
  assert.equal(best.score, 2); // 1 + 0.3 + 0.4 + 0.2 + 0.1
  assert.deepEqual(best.why, ["difficulty 2 suits a Newcomer", "in Python, which you've worked in", "touches code you know", "maintainers reply within a few days", "2 worked examples"]);
  // Unreachable repos sink for Newcomers only.
  assert.equal(rankCandidate(candidate({ unreachableReason: "needs a GPU" }), newcomer).score, 0.1);
  assert.equal(rankCandidate(candidate({ unreachableReason: "needs a GPU", difficulty: 3 }), { ...newcomer, level: "Contributor" }).score, 1.1);
  // No difficulty yet: no fit term, no crash.
  assert.equal(rankCandidate(candidate({ difficulty: null }), newcomer).score, 0.1);
});

let connection: DbConnection;
let click: number, attrs: number;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  const { db } = connection;
  [click, attrs] = (await db.insert(repos).values([
    { owner: "pallets", name: "click", language: "Python", catalog: true, health: { issueResponseHours: 10 } },
    { owner: "python-attrs", name: "attrs", language: "Python", catalog: true },
    { owner: "off", name: "catalog", language: "Python", catalog: false },
  ]).returning()).map((row) => row.id);
  const offCatalog = (await db.select().from(repos)).find((row) => row.name === "catalog")!.id;
  await db.insert(envRecipes).values([
    { repoId: click, recipeHash: "old", source: "ci", recipe: {}, status: "unreachable", unreachableReason: "old recipe", lastUsedAt: new Date("2025-01-01") },
    { repoId: click, recipeHash: "new", source: "ci", recipe: {}, status: "green", greenAt: new Date("2026-10-01") },
    { repoId: attrs, recipeHash: "x", source: "agent", recipe: {}, status: "unreachable", unreachableReason: "needs secrets" },
  ]);
  const open = (repoId: number, number: number, difficulty: number, features: Record<string, unknown> = {}, scopeNodes: string[] = []) => ({
    repoId, number, title: `issue ${number}`, state: "open" as const, createdAt: new Date(Date.UTC(2026, 0, number)),
    difficulty, difficultyReasons: [`reason ${number}`], scopeNodes, features: { assigned: false, openPrs: 0, workedExamples: 1, ...features },
  });
  await db.insert(issues).values([
    open(click, 1, 2, {}, ["click.core", "file:core.py"]),
    open(click, 2, 4),
    open(click, 3, 1, { assigned: true }),
    open(click, 4, 1, { openPrs: 1 }),
    open(attrs, 5, 2),
    open(offCatalog, 6, 1),
    { ...open(click, 7, 1), state: "closed" as const },
  ]);
  await db.insert(users).values({ id: "github|1", login: "ada", level: 0 });
  await db.insert(mapCoverage).values({ userId: "github|1", repoId: click, nodeId: "click.core", level: "explained" });
});
after(() => connection.close());

test("loadCandidates: open, unclaimed catalog issues with their newest recipe", async () => {
  const all = await loadCandidates(connection.db);
  assert.deepEqual(all.map((c) => c.number).sort(), [1, 2, 5]);
  const one = all.find((c) => c.number === 1)!;
  assert.deepEqual({ testable: one.testable, unreachable: one.unreachableReason, reasons: one.reasons, worked: one.workedExamples, url: one.url },
    { testable: true, unreachable: null, reasons: ["reason 1"], worked: 1, url: "https://github.com/pallets/click/issues/1" });
  assert.equal(all.find((c) => c.number === 5)!.unreachableReason, "needs secrets");
  assert.deepEqual((await loadCandidates(connection.db, { testableOnly: true })).map((c) => c.number).sort(), [1, 2]);
  assert.deepEqual((await loadCandidates(connection.db, { maxDifficulty: 2 })).map((c) => c.number).sort(), [1, 5]);
  assert.deepEqual(await loadCandidates(connection.db, { language: "rust" }), []);
  assert.deepEqual(await loadCandidates(connection.db, { repoIds: [] }), []);
  await assert.rejects(loadCandidates(connection.db, { limit: 0 }), RangeError);
});

test("loadUser: level, map coverage and merged languages; an unknown user is a Newcomer", async () => {
  const user = await loadUser(connection.db, "github|1", ["Python", "Go"]);
  assert.equal(user.level, "Newcomer");
  assert.deepEqual(user.languages, ["python", "go"]);
  assert.deepEqual([...user.known.get(click)!], ["click.core"]);
  const stranger = await loadUser(connection.db, "github|404", []);
  assert.deepEqual({ level: stranger.level, languages: stranger.languages, known: stranger.known.size }, { level: "Newcomer", languages: [], known: 0 });
});

test("recommend: for-you ranks by fit, continue groups known areas, explore ignores the user", async () => {
  const user = await loadUser(connection.db, "github|1", ["python"]);
  const forYou = await recommend(connection.db, "for-you", user);
  assert.ok("issues" in forYou);
  assert.equal(forYou.feed, "for-you");
  assert.equal(forYou.issues[0].number, 1); // fits, Python, known code, testable
  assert.equal(forYou.issues.at(-1)!.number, 5); // unreachable for a Newcomer
  const cont = await recommend(connection.db, "continue", user);
  assert.ok("repos" in cont);
  assert.deepEqual(cont.repos.map((r) => [r.repo, r.issues.map((i) => i.number)]), [["pallets/click", [1]]]);
  const explore = await recommend(connection.db, "explore", user, { take: 2 });
  assert.ok("issues" in explore);
  assert.equal(explore.issues.length, 2);
  assert.ok(explore.issues.every((i) => !i.why.includes("touches code you know")));
  const empty = await recommend(connection.db, "continue", { ...user, known: new Map() });
  assert.deepEqual(empty, { feed: "continue", repos: [] });
});

test("issueInsights: by repo and number, case-insensitive; unknown numbers absent", async () => {
  const found = await issueInsights(connection.db, "Pallets", "Click", [1, 2, 999, -1]);
  assert.deepEqual([...found.keys()].sort(), [1, 2]);
  assert.equal((await issueInsights(connection.db, "pallets", "click", [])).size, 0);
});

test("attachInsights: untouched with the flag off, adds recs with it on", async () => {
  const list = [{ number: 1, repo: "pallets/click" }, { number: 42, repo: "pallets/click" }];
  const saved = process.env.OPENSRCER_RECS;
  try {
    delete process.env.OPENSRCER_RECS;
    assert.equal(await attachInsights(list, (i) => i.repo, connection.db), list);
    process.env.OPENSRCER_RECS = "1";
    const withRecs = await attachInsights(list, (i) => i.repo, connection.db);
    assert.deepEqual(withRecs[0].recs, { difficulty: 2, reasons: ["reason 1"], testable: true, unreachableReason: null, workedExamples: 1 });
    assert.equal(withRecs[1].recs, undefined);
    // A database that fails leaves the list as it was.
    const broken = { execute: async () => { throw new Error("down"); } } as unknown as typeof connection.db;
    const errors = console.error;
    console.error = () => {};
    try { assert.equal(await attachInsights(list, (i) => i.repo, broken), list); } finally { console.error = errors; }
  } finally {
    if (saved === undefined) delete process.env.OPENSRCER_RECS; else process.env.OPENSRCER_RECS = saved;
  }
});

test("userLanguages: distinct lowercase primary languages; GraphQL errors throw", async () => {
  const fetch = (async () => Response.json({ data: { viewer: { repositoriesContributedTo: { nodes: [
    { primaryLanguage: { name: "Python" } }, { primaryLanguage: null }, { primaryLanguage: { name: "python" } }, { primaryLanguage: { name: "Rust" } },
  ] } } } })) as unknown as typeof globalThis.fetch;
  assert.deepEqual(await userLanguages(gh("t-langs", { fetch })), ["python", "rust"]);
  const failing = (async () => Response.json({ errors: [{ message: "no" }] })) as unknown as typeof globalThis.fetch;
  await assert.rejects(userLanguages(gh("t-langs2", { fetch: failing })));
});
