// The public profile in PGlite: opt-in, found by login, merged PRs and
// explain-it badges only, and nothing private.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb, type Db, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { contributions, lessonSteps, lessons, users } from "../db/schema";
import { appendEvents, ensureRepo, ensureUser, InvalidLoginError, rebuildStanding, UnknownUserError } from "../record/standing";
import { recordPublished } from "../record/sync";
import { profileIsPublic, profileUrlFor, ProfileNotFoundError, publicProfile, publicProfileUrl, setPublicProfile } from "../record/profile";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

let n = 0;
async function newUser(login = `user${n + 1}`): Promise<string> {
  const id = `github|${++n}`;
  await ensureUser(connection.db, id, login);
  return id;
}

test("off by default: not public, no profile link, a 404 under the login", async () => {
  const db = connection.db as Db;
  const id = await newUser("quiet");
  assert.equal(await profileIsPublic(db, id), false);
  assert.equal(await publicProfileUrl(db, id), null);
  await assert.rejects(publicProfile(db, "quiet"), ProfileNotFoundError);
  await assert.rejects(profileIsPublic(db, "github|nobody"), UnknownUserError);
  assert.equal(await publicProfileUrl(db, "github|nobody"), null);
});

test("opting in refreshes the login; opting out hides it again", async () => {
  const db = connection.db as Db;
  // A row a lesson created before the record knew the login (lib/lesson/db-store.ts).
  const id = "github|99";
  await db.insert(users).values({ id, login: id });
  await setPublicProfile(db, id, "Renamed-Login", true);
  assert.equal(await profileIsPublic(db, id), true);
  assert.equal(await publicProfileUrl(db, id), "http://localhost:3000/u/Renamed-Login");
  assert.equal((await publicProfile(db, "renamed-login")).login, "Renamed-Login", "case-insensitive");
  await setPublicProfile(db, id, "Renamed-Login", false);
  await assert.rejects(publicProfile(db, "Renamed-Login"), ProfileNotFoundError);
  await assert.rejects(setPublicProfile(db, id, "not a login!", true), InvalidLoginError);
  await assert.rejects(setPublicProfile(db, id, "ok", "yes" as never), TypeError);
  assert.equal(await profileIsPublic(db, id), false, "nothing changed by the refused calls");
});

test("the profile: merged PRs linked, per-repo counts, level, explain-it badges; never open, closed or spam", async () => {
  const db = connection.db as Db;
  const id = await newUser("carla");
  await setPublicProfile(db, id, "carla", true);
  const flask = await ensureRepo(db, "pallets/flask");
  const click = await ensureRepo(db, "pallets/click");
  const day = (d: number) => new Date(Date.UTC(2026, 9, d));
  await db.insert(contributions).values([
    { userId: id, repoId: flask, prNumber: 10, state: "merged", openedAt: day(1), mergedAt: day(2), source: "opensrcer", path: "ai" },
    { userId: id, repoId: flask, prNumber: 11, state: "merged", openedAt: day(3), mergedAt: day(4), source: "imported" },
    { userId: id, repoId: click, prNumber: 20, state: "merged", openedAt: day(5), mergedAt: day(6), source: "opensrcer", path: "self" },
    { userId: id, repoId: click, prNumber: 21, state: "open", openedAt: day(7), source: "opensrcer", path: "ai" },
    { userId: id, repoId: click, prNumber: 22, state: "closed", openedAt: day(7), source: "opensrcer", path: "ai" },
  ]);
  await appendEvents(db, id, [{ kind: "merged", ref: "pallets/flask#10", points: 100 }, { kind: "spam_flag", ref: "burst 2026-10-07", points: 0 }]);
  await rebuildStanding(db, id);

  // A lesson whose explain-it passed, published as #21 (open): a badge linked to it.
  const [lesson] = await db.insert(lessons).values({ userId: id, repoId: click, issueNumber: 3, stage: "done" }).returning({ id: lessons.id });
  await db.insert(lessonSteps).values({ lessonId: lesson.id, step: "explain-it", done: true });
  await db.update(contributions).set({ lessonId: lesson.id }).where(eq(contributions.prNumber, 21));
  // explain-it not passed: no badge.
  const [failed] = await db.insert(lessons).values({ userId: id, repoId: flask, issueNumber: 4, stage: "explain" }).returning({ id: lessons.id });
  await db.insert(lessonSteps).values({ lessonId: failed.id, step: "explain-it", done: false });
  await db.update(contributions).set({ lessonId: failed.id }).where(eq(contributions.prNumber, 10));

  const p = await publicProfile(db, "carla");
  assert.equal(p.level, "contributor");
  assert.deepEqual(p.merged.map((m) => [m.url, m.source]), [
    ["https://github.com/pallets/click/pull/20", "opensrcer"],
    ["https://github.com/pallets/flask/pull/11", "imported"],
    ["https://github.com/pallets/flask/pull/10", "opensrcer"],
  ]);
  assert.deepEqual(p.perRepo, [{ repo: "pallets/flask", merged: 2 }, { repo: "pallets/click", merged: 1 }]);
  assert.deepEqual(p.explained, [{ repo: "pallets/click", issue: 3, prUrl: "https://github.com/pallets/click/pull/21" }]);
  const text = JSON.stringify(p);
  for (const secret of ["burst", "spam", "standing", "/pull/22", "closed", "opened"]) assert.ok(!text.includes(secret), secret);
});

test("a login two opted-in rows share is not guessed between; bad logins are refused", async () => {
  const db = connection.db as Db;
  const a = await newUser("twin");
  const b = await newUser("twin");
  await setPublicProfile(db, a, "twin", true);
  assert.equal((await publicProfile(db, "twin")).login, "twin");
  await setPublicProfile(db, b, "twin", true);
  await assert.rejects(publicProfile(db, "twin"), ProfileNotFoundError);
  for (const bad of ["", "../etc", "a b", "-x", "x".repeat(40)]) await assert.rejects(publicProfile(db, bad), InvalidLoginError, bad);
});

test("recordPublished keeps the lesson a PR came from; profileUrlFor is off without the record flag", async () => {
  const db = connection.db as Db;
  const id = await newUser("dana");
  const repo = await ensureRepo(db, "pallets/flask");
  const [lesson] = await db.insert(lessons).values({ userId: id, repoId: repo, issueNumber: 9, stage: "done" }).returning({ id: lessons.id });
  await recordPublished(db, { userId: id, login: "dana", repoFull: "pallets/flask", prNumber: 900, path: "ai", lessonId: lesson.id });
  const [row] = await db.select({ lessonId: contributions.lessonId }).from(contributions).where(eq(contributions.prNumber, 900));
  assert.equal(row.lessonId, lesson.id);
  delete process.env.OPENSRCER_RECORD;
  assert.equal(await profileUrlFor(id), null);
  assert.ok((await db.select().from(users).where(eq(users.id, id))).length === 1);
});
