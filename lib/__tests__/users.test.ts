import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { users } from "../db/schema";
import { completeOnboarding, dbConfigured, ensureUser, levelHint, optionalDb } from "../users";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

test("ensureUser inserts once, then follows a renamed login", async () => {
  const { db } = connection;
  const first = await ensureUser(db, "github|1", "ada");
  assert.equal(first.login, "ada");
  assert.equal(first.onboardedAt, null);
  assert.deepEqual(first.settings, {});
  const again = await ensureUser(db, "github|1", "ada-l");
  assert.equal(again.login, "ada-l");
  assert.equal(again.createdAt.getTime(), first.createdAt.getTime());
  assert.equal((await db.select().from(users).where(eq(users.id, "github|1"))).length, 1);
});

test("ensureUser refuses a missing identity before writing", async () => {
  const { db } = connection;
  for (const [id, login] of [["", "x"], ["github|9", ""], ["x".repeat(201), "x"]]) {
    await assert.rejects(ensureUser(db, id, login), RangeError);
  }
  assert.equal((await db.select().from(users).where(eq(users.id, "github|9"))).length, 0);
});

test("completeOnboarding merges answers and keeps the first date", async () => {
  const { db } = connection;
  // A brand-new account: the row is created on the way.
  const done = await completeOnboarding(db, "github|2", "grace", { languages: ["Go"], experience: "new" });
  assert.ok(done.onboardedAt instanceof Date);
  assert.deepEqual(done.settings, { languages: ["Go"], experience: "new", levelHint: "Newcomer" });
  assert.equal(done.level, 0, "only a hint: the level itself is earned later");

  // Redone later: only what was answered changes; other settings survive.
  await db.update(users).set({ settings: { ...done.settings, digest: true } }).where(eq(users.id, "github|2"));
  const redo = await completeOnboarding(db, "github|2", "grace", { interests: ["Tests"], experience: "regular" });
  assert.deepEqual(redo.settings, { languages: ["Go"], experience: "regular", levelHint: "Regular", digest: true, interests: ["Tests"] });
  assert.equal(redo.onboardedAt?.getTime(), done.onboardedAt?.getTime());

  // Skipping ({}) marks it done without touching settings.
  const skipped = await completeOnboarding(db, "github|3", "linus", {});
  assert.ok(skipped.onboardedAt instanceof Date);
  assert.deepEqual(skipped.settings, {});
  // Never another account's row.
  assert.deepEqual((await db.select().from(users).where(eq(users.id, "github|1")))[0].settings, {});
});

test("levelHint maps experience onto the level names", () => {
  assert.deepEqual([levelHint("new"), levelHint("some"), levelHint("regular")], ["Newcomer", "Contributor", "Regular"]);
});

test("without a database configured, optionalDb answers null instead of throwing", async () => {
  const saved = { ...process.env };
  try {
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    assert.equal(dbConfigured(), false);
    assert.equal(await optionalDb(), null);
    process.env.DATABASE_URL = "postgres://h/db";
    assert.equal(dbConfigured(), true);
    delete process.env.VERCEL;
    process.env.DATABASE_URL = "mysql://h/db";
    assert.equal(dbConfigured(), false);
  } finally {
    process.env = saved;
  }
});
