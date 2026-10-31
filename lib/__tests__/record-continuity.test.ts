// Continuity after a merge (map, "Next in <area>", home project) and the home
// project the user sets themselves, in PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { InvalidRepoNameError } from "../ai-policy";
import { openDb, type Db, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { contributions, issues, repos, users } from "../db/schema";
import { CONTINUITY, homeChoices, homeProject, nextInArea, NotYourProjectError, recordMerge, setHomeProject } from "../record/continuity";
import { findRepoId, mapLevels } from "../record/map";
import { UnknownUserError } from "../record/standing";
import { mapGraph } from "./fixtures/map-graph";

let connection: DbConnection;
let app: number;
const NOW = new Date("2026-10-30T12:00:00Z");
const graph = mapGraph();

before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  const { db } = connection;
  await db.insert(users).values([{ id: "u|ada", login: "ada" }, { id: "u|bob", login: "bob", settings: { homeProject: null } }, { id: "u|cy", login: "cy" }]);
  [app] = (await db.insert(repos).values([{ owner: "acme", name: "app", catalog: true }, { owner: "acme", name: "quiet", catalog: true }]).returning()).map((r) => r.id);
  const open = (number: number, difficulty: number, scopeNodes: string[]) => ({
    repoId: app, number, title: `issue ${number}`, state: "open" as const, createdAt: NOW, difficulty, scopeNodes, features: { assigned: false, openPrs: 0 },
  });
  await db.insert(issues).values([open(10, 3, ["web3"]), open(11, 2, ["app5"]), open(12, 2, []), open(13, 2, ["web4"]), { ...open(14, 1, ["web5"]), features: { assigned: true, openPrs: 0 } }]);
});
after(() => connection.close());

const settings = async (db: Db, id: string) => (await db.select({ s: users.settings }).from(users).where(eq(users.id, id)))[0].s;
const merged = (db: Db, userId: string, prNumber: number, repoId = app) =>
  db.insert(contributions).values({ userId, repoId, prNumber, state: "merged", openedAt: NOW, mergedAt: NOW, source: "opensrcer" });

test("recordMerge: files become changed, the area is kept for the card, the second merge makes a home", async () => {
  const { db } = connection;
  await merged(db, "u|ada", 1);
  const first = await recordMerge(db, { userId: "u|ada", repoId: app, repoFull: "acme/app", prNumber: 1, files: ["src/web/views.py"] }, graph, NOW);
  assert.deepEqual(first, { changed: 10, area: "src/web", home: false });
  const levels = await mapLevels(db, "u|ada", app);
  assert.deepEqual([levels.size, levels.get("web0")], [10, "changed"]);
  const next = (await settings(db, "u|ada")).nextInArea as { area: string; nodes: string[]; pr: number; at: string };
  assert.deepEqual([next.area, next.pr, next.nodes.length, next.at], ["src/web", 1, 10, NOW.toISOString()]);
  assert.equal(Object.hasOwn(await settings(db, "u|ada"), "homeProject"), false, "one merge is not a home yet");

  await merged(db, "u|ada", 2);
  const second = await recordMerge(db, { userId: "u|ada", repoId: app, repoFull: "acme/app", prNumber: 2, files: ["docs/x.md"] }, graph, NOW);
  assert.deepEqual(second, { changed: 0, area: null, home: true });
  assert.equal(await homeProject(db, "u|ada"), "acme/app");
  assert.equal(((await settings(db, "u|ada")).nextInArea as { area: string | null }).area, null, "the latest merge's area, even when none");
});

test("recordMerge: a home the user chose or cleared stays; no graph moves only the home; bad input writes nothing", async () => {
  const { db } = connection;
  await merged(db, "u|bob", 3);
  await merged(db, "u|bob", 4);
  const result = await recordMerge(db, { userId: "u|bob", repoId: app, repoFull: "acme/app", prNumber: 4, files: ["src/web/views.py"] }, null, NOW);
  assert.deepEqual(result, { changed: 0, area: null, home: false });
  assert.equal(await homeProject(db, "u|bob"), null, "cleared on /account: no merge picks one again");
  await assert.rejects(recordMerge(db, { userId: "u|bob", repoId: app, repoFull: "acme/app", prNumber: 0, files: [] }, graph, NOW), RangeError);
  await assert.rejects(recordMerge(db, { userId: "u|404", repoId: app, repoFull: "acme/app", prNumber: 5, files: ["src/web/views.py"] }, graph, NOW), UnknownUserError);
});

test("setHomeProject: a repository in the record (canonical case) or null; anything else is refused", async () => {
  const { db } = connection;
  assert.deepEqual(await homeChoices(db, "u|ada"), ["acme/app"]);
  assert.deepEqual(await homeChoices(db, "u|cy"), []);
  assert.equal(await setHomeProject(db, "u|ada", "ACME/App"), "acme/app");
  assert.equal(await setHomeProject(db, "u|ada", null), null);
  assert.equal(await homeProject(db, "u|ada"), null);
  await assert.rejects(setHomeProject(db, "u|ada", "acme/quiet"), NotYourProjectError, "no PR of theirs there");
  await assert.rejects(setHomeProject(db, "u|ada", "acme"), InvalidRepoNameError);
  await assert.rejects(setHomeProject(db, "u|404", "acme/app"), UnknownUserError);
  await assert.rejects(homeProject(db, "u|404"), UnknownUserError);
  assert.equal(await homeProject(db, "u|ada"), null, "refused calls changed nothing");
  assert.equal(await setHomeProject(db, "u|ada", "acme/app"), "acme/app");
});

test("nextInArea: the merged area's issues first, ranked; null when stale, missing or empty", async () => {
  const { db } = connection;
  const card = (await nextInArea(db, "u|ada", NOW))!;
  // Ada's latest merge (#2) touched no area; give her #1's card back.
  assert.equal(card.area, null);
  await db.update(users).set({ settings: { nextInArea: { repo: "acme/app", pr: 1, area: "src/web", nodes: graph.nodes.filter((n) => n.id.startsWith("web")).map((n) => n.id), at: NOW.toISOString() } } }).where(eq(users.id, "u|ada"));
  const web = (await nextInArea(db, "u|ada", NOW))!;
  assert.deepEqual([web.repo, web.pr, web.area], ["acme/app", 1, "src/web"]);
  assert.deepEqual(web.issues.map((i) => i.number), [13, 10, 11], "in the area first (even at a less fitting difficulty), claimed ones never, at most CONTINUITY.nextIssues");
  assert.equal(web.issues.length, CONTINUITY.nextIssues);
  assert.ok(web.issues[0].why.includes("touches code you know"));
  const later = new Date(NOW.getTime() + (CONTINUITY.nextDays + 1) * 86_400_000);
  assert.equal(await nextInArea(db, "u|ada", later), null, "the card expires");
  assert.equal(await nextInArea(db, "u|cy", NOW), null, "nothing merged");
  await db.update(users).set({ settings: { nextInArea: { repo: "gone/repo", pr: 1, area: null, nodes: [], at: NOW.toISOString() } } }).where(eq(users.id, "u|cy"));
  assert.equal(await nextInArea(db, "u|cy", NOW), null, "a repository not in the database");
  const quiet = (await findRepoId(db, "acme/quiet"))!;
  await merged(db, "u|cy", 9, quiet);
  await recordMerge(db, { userId: "u|cy", repoId: quiet, repoFull: "acme/quiet", prNumber: 9, files: [] }, null, NOW);
  assert.equal(await nextInArea(db, "u|cy", NOW), null, "no open issues there");
  await assert.rejects(nextInArea(db, "u|404", NOW), UnknownUserError);
});
