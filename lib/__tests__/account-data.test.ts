// "Export my data" / "Delete my data" against a real (PGlite) database, an
// in-memory Blob store and a temporary .dispatches directory, each holding
// two accounts: everything of one goes, nothing of the other is touched.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { openDb, type Db, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { alerts, contributions, lessonMessages, lessonSteps, lessons, mapCoverage, repos, standingEvents, users } from "../db/schema";
import {
  type BlobStore, deleteLocalUserData, deleteUserBlobs, deleteUserRows, exportUserRows, listUserBlobs,
  localUserRuns, localUserStats, userBlobPaths,
} from "../account-data";

const ME = "github|100";
const OTHER = "github|200";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

/** One of everything that references users, for `id`; `n` keeps unique keys apart. */
async function seed(db: Db, id: string, login: string, n: number) {
  // homeProject and nextInArea: lib/record/continuity.ts keeps them in settings.
  await db.insert(users).values({ id, login, settings: { languages: ["Go"], homeProject: `acme/r${n}`, nextInArea: { repo: `acme/r${n}`, pr: n, area: null, nodes: [], at: "2026-10-30T00:00:00Z" } } });
  const [repo] = await db.insert(repos).values({ owner: "acme", name: `r${n}` }).returning();
  const [lesson] = await db.insert(lessons).values({ userId: id, repoId: repo.id, issueNumber: n, stage: "kickoff" }).returning();
  await db.insert(lessonSteps).values({ lessonId: lesson.id, step: "s1", answer: `answer ${n}` });
  await db.insert(lessonMessages).values({ lessonId: lesson.id, seq: 1, role: "user", content: `hello ${n}` });
  await db.insert(contributions).values({ userId: id, lessonId: lesson.id, repoId: repo.id, prNumber: n, state: "open", openedAt: new Date(), source: "opensrcer" });
  await db.insert(mapCoverage).values({ userId: id, repoId: repo.id, nodeId: "file:a.py", level: "explored" });
  await db.insert(standingEvents).values({ userId: id, kind: "pr_opened", points: 1, ref: `acme/r${n}#${n}` });
  await db.insert(alerts).values({ userId: id, repoId: repo.id, issueNumber: n, reason: { why: "new" } });
}

const counts = async (db: Db, id: string) => {
  const one = async (table: typeof lessons | typeof contributions | typeof mapCoverage | typeof standingEvents | typeof alerts) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, id)))[0].n;
  return {
    users: (await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.id, id)))[0].n,
    lessons: await one(lessons), contributions: await one(contributions), mapCoverage: await one(mapCoverage),
    standingEvents: await one(standingEvents), alerts: await one(alerts),
  };
};

test("export holds the account's rows and none of another's", async () => {
  const { db } = connection;
  await seed(db, ME, "me", 1);
  await seed(db, OTHER, "other", 2);
  const data = await exportUserRows(db, ME);
  assert.deepEqual(data.users.map((row) => row.id), [ME]);
  assert.equal(data.users[0].settings.homeProject, "acme/r1", "the home project and the next-in-area card go with the users row");
  assert.ok(data.users[0].settings.nextInArea);
  for (const key of ["lessons", "contributions", "mapCoverage", "standingEvents", "alerts"] as const) {
    assert.equal(data[key].length, 1, key);
    assert.ok(data[key].every((row) => row.userId === ME), key);
  }
  assert.deepEqual(data.lessonSteps.map((row) => row.answer), ["answer 1"]);
  assert.deepEqual(data.lessonMessages.map((row) => row.content), ["hello 1"]);
  // Serializable as the download is.
  assert.doesNotThrow(() => JSON.stringify(data));

  const empty = await exportUserRows(db, "github|unknown");
  assert.deepEqual(Object.values(empty).map((rows) => rows.length), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test("delete erases the account's rows through the cascade, and only those", async () => {
  const { db } = connection;
  const otherBefore = await counts(db, OTHER);
  assert.equal(await deleteUserRows(db, ME), 1);
  assert.deepEqual(await counts(db, ME), { users: 0, lessons: 0, contributions: 0, mapCoverage: 0, standingEvents: 0, alerts: 0 });
  const orphanSteps = await db.execute(sql`select count(*)::int as n from lesson_steps s left join lessons l on l.id = s.lesson_id where l.id is null`);
  assert.equal((orphanSteps.rows[0] as { n: number }).n, 0);
  assert.deepEqual(await counts(db, OTHER), otherBefore);
  assert.equal((await exportUserRows(db, OTHER)).lessonMessages.length, 1);
  // Repeating it is harmless; an unknown account deletes nothing.
  assert.equal(await deleteUserRows(db, ME), 0);
  assert.equal(await deleteUserRows(db, "github|unknown"), 0);
  await assert.rejects(deleteUserRows(db, ""), RangeError);
  assert.equal((await counts(db, OTHER)).users, 1);
});

/** @vercel/blob's list/del over a Map, paging `limit` at a time. */
function memoryStore(paths: string[], { leak = false } = {}) {
  const blobs = new Map(paths.map((pathname) => [pathname, { pathname, size: 1, uploadedAt: new Date(0) }]));
  const deleted: string[] = [];
  const store: BlobStore = {
    async list({ prefix, cursor, limit = 1000 }) {
      // `leak` plays a misbehaving listing that ignores the prefix.
      const all = [...blobs.values()].filter((blob) => leak || blob.pathname.startsWith(prefix)).sort((a, b) => a.pathname.localeCompare(b.pathname));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + Math.min(limit, 2));
      const next = start + page.length;
      return { blobs: page, hasMore: next < all.length, cursor: next < all.length ? String(next) : undefined };
    },
    async del(pathnames) {
      for (const pathname of pathnames) { blobs.delete(pathname); deleted.push(pathname); }
    },
  };
  return { store, blobs, deleted };
}

test("Blob records: listed across pages, deleted, the other account untouched", async () => {
  const mine = userBlobPaths(ME);
  const theirs = userBlobPaths(OTHER);
  assert.match(mine.prefix, /^users\/[0-9a-f]{64}\/$/);
  assert.match(mine.stats, /^stats\/[0-9a-f]{64}\.json$/);
  assert.notEqual(mine.prefix, theirs.prefix);
  const own = [`${mine.prefix}runs/c_1.json`, `${mine.prefix}run-summaries/c_1.json`, `${mine.prefix}graphs/a/b.json.gz`, `${mine.prefix}lifecycle/a__b__1.json`, `${mine.prefix}fork-ci/c_1.json`, mine.stats];
  const foreign = [`${theirs.prefix}runs/c_2.json`, theirs.stats, `${mine.prefix.slice(0, -1)}-not-mine/x.json`, `${mine.stats}.bak`, "graphs/acme/r1/latest.json"];
  const { store, blobs, deleted } = memoryStore([...own, ...foreign]);

  assert.deepEqual((await listUserBlobs(store, ME)).map((blob) => blob.pathname).sort(), [...own].sort());
  assert.equal(await deleteUserBlobs(store, ME), own.length);
  assert.deepEqual([...blobs.keys()].sort(), [...foreign].sort());
  assert.deepEqual(deleted.sort(), [...own].sort());
  assert.equal(await deleteUserBlobs(store, ME), 0, "nothing left to delete");
});

test("a listing that returns other paths still only deletes the account's own", async () => {
  const mine = userBlobPaths(ME);
  const theirs = userBlobPaths(OTHER);
  const { store, blobs } = memoryStore([`${mine.prefix}runs/c_1.json`, `${theirs.prefix}runs/c_2.json`, theirs.stats], { leak: true });
  assert.equal(await deleteUserBlobs(store, ME), 1);
  assert.deepEqual([...blobs.keys()].sort(), [`${theirs.prefix}runs/c_2.json`, theirs.stats].sort());
});

test("local .dispatches: the account's runs and stats go, nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "account-data-"));
  try {
    const write = (path: string, body: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
    const run = (id: string, owner: string) => JSON.stringify({ id, auth0_user_id: owner, status: "succeeded" });
    write("d_mine1.json", run("d_mine1", ME));
    write("d_mine1.log", "log");
    write("d_mine1/preview.json", "{}");
    write("d_mine2.json", run("d_mine2", ME));
    write("d_theirs.json", run("d_theirs", OTHER));
    write("d_theirs.log", "log");
    write("d_mislabeled.json", run("d_other_id", ME)); // id doesn't match the file: not a run of mine
    write("d_broken.json", "{ half-writ");
    write("stats.json", run("stats", ME)); // not a run id
    write("repo-stars.json", "{}");
    write("crucible-orgs.json", "[]");
    write(userBlobPaths(ME).stats, JSON.stringify({ scans: 3 }));
    write(userBlobPaths(OTHER).stats, JSON.stringify({ scans: 9 }));

    assert.deepEqual(localUserRuns(dir, ME).map((r) => r.id).sort(), ["d_mine1", "d_mine2"]);
    assert.deepEqual(localUserStats(dir, ME), { scans: 3 });
    assert.equal(localUserStats(dir, "github|none"), null);
    assert.equal(deleteLocalUserData(dir, ME), 2);

    assert.deepEqual(readdirSync(dir).sort(), ["crucible-orgs.json", "d_broken.json", "d_mislabeled.json", "d_theirs.json", "d_theirs.log", "repo-stars.json", "stats", "stats.json"]);
    assert.equal(existsSync(join(dir, userBlobPaths(ME).stats)), false);
    assert.deepEqual(localUserStats(dir, OTHER), { scans: 9 });
    assert.deepEqual(localUserRuns(dir, OTHER).map((r) => r.id), ["d_theirs"]);
    assert.equal(deleteLocalUserData(dir, ME), 0, "repeating it is harmless");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(localUserRuns(join(tmpdir(), "account-data-missing-dir"), ME), []);
});
