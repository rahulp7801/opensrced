// Round trip on PGlite: the generated migrations apply, and the schema holds
// a lesson and an issue with an embedding that a similarity search finds.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { EMBEDDING_DIMENSIONS, issues, lessonSteps, lessons, repos, users } from "../db/schema";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

/** A unit vector along `axis`, nudged toward `toward` by `weight`. */
function embedding(axis: number, toward?: number, weight = 0): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[axis] = 1;
  if (toward !== undefined) v[toward] = weight;
  return v;
}

test("migrations are idempotent and turn on pgvector", async () => {
  await migrateDb(connection);
  const { rows } = await connection.db.execute(sql`select extname from pg_extension where extname = 'vector'`);
  assert.equal(rows.length, 1);
});

test("a lesson and its steps round-trip", async () => {
  const { db } = connection;
  await db.insert(users).values({ id: "github|1", login: "ada" });
  const [repo] = await db.insert(repos).values({ owner: "pallets", name: "flask", language: "Python", catalog: true }).returning();
  const [lesson] = await db.insert(lessons).values({ userId: "github|1", repoId: repo.id, issueNumber: 42, path: "ai", stage: "kickoff" }).returning();
  assert.match(lesson.id, /^[0-9a-f-]{36}$/);
  assert.equal(lesson.mode, "short");
  assert.ok(lesson.startedAt instanceof Date);
  await db.insert(lessonSteps).values({ lessonId: lesson.id, step: "s1", answer: "the router", grade: { score: 2 } });
  const [step] = await db.select().from(lessonSteps).where(eq(lessonSteps.lessonId, lesson.id));
  assert.deepEqual({ answer: step.answer, grade: step.grade, hintsUsed: step.hintsUsed }, { answer: "the router", grade: { score: 2 }, hintsUsed: 0 });
  // Deleting the lesson takes its steps with it.
  await db.delete(lessons).where(eq(lessons.id, lesson.id));
  assert.equal((await db.select().from(lessonSteps).where(eq(lessonSteps.lessonId, lesson.id))).length, 0);
});

test("issues store an embedding, rank by cosine similarity and match full text", async () => {
  const { db } = connection;
  const [repo] = await db.insert(repos).values({ owner: "psf", name: "requests" }).returning();
  const base = { repoId: repo.id, state: "open" as const, createdAt: new Date("2026-10-01T00:00:00Z") };
  await db.insert(issues).values([
    { ...base, number: 1, title: "Crash when the timeout is zero", bodyExcerpt: "Session.get raises", labels: ["bug"], embedding: embedding(0) },
    { ...base, number: 2, title: "Docs typo", bodyExcerpt: "spelling in the README", embedding: embedding(1) },
    { ...base, number: 3, title: "Timeout ignored on redirects", bodyExcerpt: "the redirect loop drops it", embedding: embedding(0, 1, 0.5) },
  ]);
  const [stored] = await db.select().from(issues).where(and(eq(issues.repoId, repo.id), eq(issues.number, 1)));
  assert.equal(stored.embedding?.length, EMBEDDING_DIMENSIONS);
  assert.deepEqual(stored.labels, ["bug"]);

  const query = embedding(0, 1, 0.1);
  const distance = cosineDistance(issues.embedding, query);
  const ranked = await db.select({ number: issues.number, distance }).from(issues).where(eq(issues.repoId, repo.id)).orderBy(asc(distance));
  assert.deepEqual(ranked.map((row) => row.number), [1, 3, 2]);

  const text = await db.select({ number: issues.number }).from(issues)
    .where(sql`${issues.tsv} @@ plainto_tsquery('english', 'timeouts')`).orderBy(asc(issues.number));
  assert.deepEqual(text.map((row) => row.number), [1, 3]);
});

test("constraints reject duplicates, dangling references and wrong-sized vectors", async () => {
  const { db } = connection;
  const [repo] = await db.insert(repos).values({ owner: "o", name: "constraints" }).returning();
  const issue = { repoId: repo.id, number: 7, title: "t", state: "open" as const, createdAt: new Date() };
  await db.insert(issues).values(issue);
  await assert.rejects(db.insert(issues).values(issue).execute());
  await assert.rejects(db.insert(repos).values({ owner: "o", name: "constraints" }).execute());
  await assert.rejects(db.insert(lessons).values({ userId: "github|nobody", repoId: repo.id, issueNumber: 7, stage: "kickoff" }).execute());
  await assert.rejects(db.insert(issues).values({ ...issue, number: 8, embedding: [1, 0, 0] }).execute());
});
