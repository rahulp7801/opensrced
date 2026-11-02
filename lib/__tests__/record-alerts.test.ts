// "You know this code" alerts: who hears about which new issue (pure), and
// writing, listing and dismissing them in PGlite, with the weekly cap.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { alerts, issues, repos, users } from "../db/schema";
import { ALERTS, createAlerts, dismissAlerts, pickAlerts, UnknownAlertError, unreadAlerts } from "../record/alerts";
import { markNodes } from "../record/map";
import { mapGraph } from "./fixtures/map-graph";

let connection: DbConnection;
let repoId: number;
const NOW = new Date("2026-10-30T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  const { db } = connection;
  await db.insert(users).values([{ id: "u|changed", login: "ada" }, { id: "u|explained", login: "bob" }, { id: "u|explored", login: "cy" }, { id: "u|full", login: "dee" }]);
  repoId = (await db.insert(repos).values({ owner: "acme", name: "app", catalog: true }).returning())[0].id;
  await markNodes(db, "u|changed", "acme/app", { level: "changed", nodes: ["web0", "web1"] });
  await markNodes(db, "u|explained", "acme/app", { level: "explained", nodes: ["app0"] });
  await markNodes(db, "u|explored", "acme/app", { level: "explored", nodes: ["web0", "app0"] });
  await markNodes(db, "u|full", "acme/app", { level: "changed", nodes: ["web0"] });
  // u|full already had ALERTS.perWeek this week (one dismissed), plus an old one outside the window.
  for (let n = 1; n <= ALERTS.perWeek; n++) await db.insert(alerts).values({ userId: "u|full", repoId, issueNumber: 900 + n, reason: {}, createdAt: daysAgo(n), seenAt: n === 1 ? daysAgo(0) : null });
  await db.insert(alerts).values({ userId: "u|changed", repoId, issueNumber: 800, reason: {}, createdAt: daysAgo(ALERTS.windowDays + 1) });
  for (const number of [1, 2, 3, 4, 5]) {
    await db.insert(issues).values({ repoId, number, title: `Issue ${number}`, state: "open", createdAt: NOW });
  }
});
after(() => connection.close());

const known = (entries: Record<string, string[]>) => new Map(Object.entries(entries).map(([user, nodes]) => [user, new Set(nodes)]));

test("pickAlerts: most overlap first, file tokens never match, empty input picks nothing", () => {
  const issuesIn = [{ number: 7, scopeNodes: ["a"] }, { number: 3, scopeNodes: ["a", "b", "b"] }, { number: 5, scopeNodes: ["file:x.py", "c"] }, { number: 1, scopeNodes: ["a"] }];
  assert.deepEqual(pickAlerts(issuesIn, known({ u: ["a", "b", "file:x.py"] }), new Map()), [
    { userId: "u", number: 3, overlap: ["a", "b"] }, { userId: "u", number: 1, overlap: ["a"] }, { userId: "u", number: 7, overlap: ["a"] },
  ]);
  assert.deepEqual(pickAlerts([], known({ u: ["a"] }), new Map()), []);
  assert.deepEqual(pickAlerts(issuesIn, new Map(), new Map()), []);
});

test("pickAlerts: the weekly cap counts what was already sent, at its boundary", () => {
  const many = [1, 2, 3, 4].map((number) => ({ number, scopeNodes: ["a"] }));
  const user = known({ u: ["a"] });
  assert.equal(pickAlerts(many, user, new Map()).length, 3, "at most perWeek");
  assert.equal(pickAlerts(many, user, new Map([["u", 2]])).length, 1, "one left");
  assert.equal(pickAlerts(many, user, new Map([["u", 3]])).length, 0, "at the cap");
  assert.equal(pickAlerts(many, user, new Map([["u", 5]])).length, 0, "over the cap");
  assert.equal(pickAlerts(many, user, new Map(), 0).length, 0, "a zero cap sends nothing");
});

test("createAlerts: explained/changed overlap only, within the weekly cap, once per issue", async () => {
  const { db } = connection;
  const fresh = [
    { number: 1, scopeNodes: ["web0", "web1", "file:views.py"] },
    { number: 2, scopeNodes: ["app0"] },
    { number: 3, scopeNodes: ["tool0"] },
  ];
  assert.equal(await createAlerts(db, repoId, fresh, mapGraph(), NOW), 2);
  const rows = await db.select().from(alerts).where(eq(alerts.createdAt, NOW));
  assert.deepEqual(rows.map((r) => [r.userId, r.issueNumber, r.reason]).sort(), [
    ["u|changed", 1, { kind: "known_code", nodes: ["web0", "web1"], changed: true, area: "src/web" }],
    ["u|explained", 2, { kind: "known_code", nodes: ["app0"], changed: false, area: "src/app" }],
  ], "explored-only and capped users get nothing; an alert older than the window does not count");
  assert.equal(await createAlerts(db, repoId, fresh, mapGraph(), NOW), 0, "the same issue never alerts twice");
  assert.equal(await createAlerts(db, repoId, [{ number: 4, scopeNodes: ["app0"] }], null, NOW), 1, "without a graph the alert has no area");
  assert.equal(((await db.select().from(alerts).where(eq(alerts.issueNumber, 4)))[0].reason as { area: unknown }).area, null);
  assert.equal(await createAlerts(db, repoId, [], null, NOW), 0);
  assert.equal(await createAlerts(db, repoId, [{ number: 5, scopeNodes: ["file:core.py"] }], null, NOW), 0, "file tokens alone match nobody");
  await assert.rejects(createAlerts(db, 0, fresh, null, NOW), RangeError);
});

test("unreadAlerts and dismissAlerts: one, twice, all; other users' and unknown ids are refused", async () => {
  const { db } = connection;
  const unread = await unreadAlerts(db, "u|explained");
  assert.deepEqual(unread.map((a) => [a.repo, a.number, a.title]), [["acme/app", 4, "Issue 4"], ["acme/app", 2, "Issue 2"]]);
  assert.equal(await dismissAlerts(db, "u|explained", unread[0].id, NOW), 1);
  assert.equal(await dismissAlerts(db, "u|explained", unread[0].id, NOW), 0, "dismissing again is harmless");
  assert.deepEqual((await unreadAlerts(db, "u|explained")).map((a) => a.number), [2]);
  const theirs = (await unreadAlerts(db, "u|changed"))[0].id;
  await assert.rejects(dismissAlerts(db, "u|explained", theirs, NOW), UnknownAlertError);
  for (const bad of [0, -1, 1.5, 999_999]) await assert.rejects(dismissAlerts(db, "u|explained", bad, NOW), UnknownAlertError, String(bad));
  assert.equal((await unreadAlerts(db, "u|changed")).length, 2, "nothing of theirs was dismissed");
  assert.equal(await dismissAlerts(db, "u|changed", "all", NOW), 2);
  assert.deepEqual(await unreadAlerts(db, "u|changed"), []);
  assert.equal(await dismissAlerts(db, "u|changed", "all", NOW), 0);
  assert.deepEqual(await unreadAlerts(db, "u|nobody"), []);
});
