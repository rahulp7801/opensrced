// The project map: marking nodes in PGlite, and the pure area/coverage/lesson helpers.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { InvalidRepoNameError } from "../ai-policy";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { users } from "../db/schema";
import {
  areaOf, askedMark, coverage, findRepoId, graphAreas, InvalidMapMarkError, lessonNote, MAP, mapLevels, markNodes, namedNodes,
  nodesForFiles, passedMark, repoMaps, type MapLevel,
} from "../record/map";
import { UnknownUserError } from "../record/standing";
import { mapGraph } from "./fixtures/map-graph";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  await connection.db.insert(users).values([{ id: "github|1", login: "ada" }, { id: "github|2", login: "bob" }]);
});
after(() => connection.close());

const graph = mapGraph();

test("markNodes: records nodes, only ever raises a level, dedupes, and is per user", async () => {
  const { db } = connection;
  assert.equal(await markNodes(db, "github|1", "acme/app", { level: "explored", nodes: ["app0", "app1", "app1"] }), 2);
  const repoId = (await findRepoId(db, "ACME/App"))!;
  assert.ok(repoId > 0, "found case-insensitively");
  assert.equal(await markNodes(db, "github|1", "acme/app", { level: "changed", nodes: ["app0"] }), 1);
  assert.equal(await markNodes(db, "github|1", "acme/app", { level: "explained", nodes: ["app0", "app1"] }), 1, "app0 stays changed; app1 rises");
  assert.equal(await markNodes(db, "github|1", "acme/app", { level: "explored", nodes: ["app0", "app1"] }), 0, "never lowered");
  assert.deepEqual(Object.fromEntries(await mapLevels(db, "github|1", repoId)), { app0: "changed", app1: "explained" });
  assert.equal((await mapLevels(db, "github|2", repoId)).size, 0, "another user's map is untouched");
  assert.equal(await markNodes(db, "github|1", "acme/app", { level: "explored", nodes: [] }), 0, "an empty mark writes nothing");
});

test("markNodes: rejects bad levels, node ids, unknown users and repo names before writing", async () => {
  const { db } = connection;
  const bad: Array<[unknown, (e: Error) => boolean]> = [
    [{ level: "mastered", nodes: ["a"] }, (e) => e instanceof InvalidMapMarkError],
    [{ level: "explored", nodes: "a" }, (e) => e instanceof InvalidMapMarkError],
    [{ level: "explored", nodes: [""] }, (e) => e instanceof InvalidMapMarkError],
    [{ level: "explored", nodes: ["x".repeat(301)] }, (e) => e instanceof InvalidMapMarkError],
    [{ level: "explored", nodes: Array.from({ length: MAP.maxMark + 1 }, (_, i) => `n${i}`) }, (e) => e instanceof InvalidMapMarkError],
  ];
  for (const [mark, check] of bad) await assert.rejects(markNodes(db, "github|1", "other/repo", mark as never), check, JSON.stringify(mark).slice(0, 60));
  await assert.rejects(markNodes(db, "github|404", "other/repo", { level: "explored", nodes: ["a"] }), UnknownUserError);
  await assert.rejects(markNodes(db, "github|1", "not-a-repo", { level: "explored", nodes: ["a"] }), InvalidRepoNameError);
  assert.equal(await findRepoId(db, "other/repo"), null, "no repo row was created by a rejected mark");
});

test("graphAreas: modules merged by name, small ones dropped, largest first; empty graph has none", () => {
  assert.deepEqual(graphAreas(graph).map((a) => [a.name, a.ids.length]), [["src/app", 12], ["src/web", 10]]);
  assert.deepEqual(graphAreas({ nodes: [], links: [] }), []);
});

test("areaOf: the area holding most of the nodes, or null", () => {
  const areas = graphAreas(graph);
  assert.equal(areaOf(["web1", "web2", "app1"], areas)?.name, "src/web");
  assert.equal(areaOf(["tool0"], areas), null, "outside every counted area");
  assert.equal(areaOf([], areas), null);
});

test("coverage: per-area level and counts; known needs explained or changed", () => {
  const levels = new Map<string, MapLevel>([["app0", "explored"], ["app1", "explained"], ["web0", "explored"]]);
  assert.deepEqual(coverage(graphAreas(graph), levels), {
    areas: [{ name: "src/app", nodes: 12, marked: 2, level: "explained" }, { name: "src/web", nodes: 10, marked: 1, level: "explored" }],
    known: ["src/app"], total: 2,
  });
  assert.deepEqual(coverage(graphAreas(graph), new Map()).known, []);
  assert.deepEqual(coverage([], levels), { areas: [], known: [], total: 0 });
});

test("nodesForFiles: every node in the PR's files; blank and unknown paths match nothing", () => {
  assert.deepEqual(nodesForFiles(graph, ["src/web/views.py"]).sort(), Array.from({ length: 10 }, (_, i) => `web${i}`).sort());
  assert.deepEqual(nodesForFiles(graph, []), []);
  assert.deepEqual(nodesForFiles(graph, ["", "  "]), [], "a blank path must not match every node");
  assert.deepEqual(nodesForFiles(graph, ["docs/index.md"]), []);
});

test("namedNodes: exact label matches, short labels never, up to the limit", () => {
  assert.deepEqual(namedNodes(graph, "The Session class calls render_page() to draw it."), ["app0", "web0"]);
  assert.deepEqual(namedNodes(graph, "go go go"), [], "labels under 3 characters are too common");
  assert.deepEqual(namedNodes(graph, "Session render_page", 1), ["app0"]);
  assert.deepEqual(namedNodes(graph, ""), []);
});

test("askedMark: the question's subject is explored; no graph or no subject marks nothing", () => {
  assert.deepEqual(askedMark(graph, "What does render_page do?"), { level: "explored", nodes: ["web0"] });
  assert.equal(askedMark(graph, "where do I start?"), null);
  assert.equal(askedMark(null, "What does render_page do?"), null);
});

test("passedMark: s1/s8 mark what the answer names, s7 its good picks, explain-it the fix; failures mark nothing", () => {
  const passed = { passed: true, feedback: "" };
  const ctx = { graph, answerKey: { diff: "+++ b/src/web/views.py\n+x = 1", diagnosis: "", cases: [], title: "" } };
  assert.deepEqual(passedMark("s1", "It has a Session object and pages.", passed, ctx), { level: "explained", nodes: ["app0"] });
  // s8 is before the reveal: the answer key's nodes must never appear on the map.
  assert.deepEqual(passedMark("s8", "I would change Session so it keeps the cookie.", passed, ctx), { level: "explained", nodes: ["app0"] });
  assert.equal(passedMark("s8", "Fix the bug and add a test.", passed, ctx), null);
  const s7 = { passed: true, feedback: "", detail: { results: [
    { pick: "./src/app/core.py", verdict: "close", hops: 2 }, { pick: "render_page()", verdict: "on_target", hops: 0 }, { pick: "tools/run.py", verdict: "red_herring", hops: null },
  ] } };
  const picked = passedMark("s7", ["./src/app/core.py", "render_page()", "tools/run.py"], s7, ctx)!;
  assert.equal(picked.level, "explained");
  assert.deepEqual(picked.nodes.sort(), [...Array.from({ length: 12 }, (_, i) => `app${i}`), "web0"].sort(), "red herrings are not marked");
  assert.equal(passedMark("explain-it", {}, passed, ctx)!.nodes.length, 10);
  assert.equal(passedMark("explain-it", {}, passed, { graph, answerKey: null }), null);
  assert.equal(passedMark("s1", "It has a Session object.", { passed: false, feedback: "" }, ctx), null);
  assert.equal(passedMark("s1", "It has a Session object.", null, ctx), null);
  assert.equal(passedMark("s1", "It has a Session object.", passed, { graph: null, answerKey: null }), null);
  assert.equal(passedMark("s2", "Session", passed, ctx), null, "other steps mark nothing");
});

test("lessonNote: null on a first visit; names the area next to changed code", () => {
  assert.equal(lessonNote(graph, new Map(), ["app1"]), null);
  const levels = new Map<string, MapLevel>([["web0", "changed"], ["web1", "explained"]]);
  assert.deepEqual(lessonNote(graph, levels, ["app1", "file:core.py"]), { known: ["src/web"], total: 2, nearChanged: "src/app" });
  assert.equal(lessonNote(graph, levels, ["app5"])!.nearChanged, null, "more than MAP.nearHops away");
  assert.equal(lessonNote(graph, new Map<string, MapLevel>([["app0", "explored"]]), ["app1"])!.nearChanged, null, "nothing changed yet");
  assert.equal(lessonNote(graph, levels, ["tool0", "web0"])!.nearChanged, "src/web", "the changed node itself");
});

test("repoMaps: per repository, newest first, with coverage only where a graph exists", async () => {
  const { db } = connection;
  await markNodes(db, "github|2", "acme/app", { level: "changed", nodes: ["web0"] }, new Date("2026-10-01T00:00:00Z"));
  await markNodes(db, "github|2", "acme/lib", { level: "explored", nodes: ["x"] }, new Date("2026-10-02T00:00:00Z"));
  const maps = await repoMaps(db, "github|2", async (repo) => (repo === "acme/app" ? graph : null));
  assert.deepEqual(maps.map((m) => [m.repo, m.counts, m.coverage?.known ?? null]), [
    ["acme/lib", { explored: 1, explained: 0, changed: 0 }, null],
    ["acme/app", { explored: 0, explained: 0, changed: 1 }, ["src/web"]],
  ]);
  assert.deepEqual(await repoMaps(db, "github|404", async () => graph), [], "an unknown user has no maps");
});
