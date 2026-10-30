import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { dbTarget, getDb } from "../db/client";
import { lessons } from "../db/schema";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { process.env = saved; }
}

const local = { VERCEL: undefined, OPENSRCER_EXECUTION: undefined };

test("dbTarget: Postgres URLs go to Neon, everything else local to PGlite", () => {
  withEnv(local, () => {
    const neon = "postgresql://user:pw@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
    assert.deepEqual(dbTarget(neon), { driver: "neon", url: neon });
    assert.deepEqual(dbTarget("postgres://localhost/db"), { driver: "neon", url: "postgres://localhost/db" });
    for (const memory of [undefined, "", "pglite:", "pglite:memory"]) assert.deepEqual(dbTarget(memory), { driver: "pglite" }, String(memory));
    assert.deepEqual(dbTarget("pglite:./.pglite"), { driver: "pglite", dataDir: "./.pglite" });
  });
});

test("dbTarget refuses unknown schemes, and PGlite when hosted", () => {
  withEnv(local, () => {
    for (const bad of ["mysql://localhost/db", "localhost:5432", "file:db.sqlite"]) assert.throws(() => dbTarget(bad), /postgres:\/\/ URL or pglite/, bad);
  });
  withEnv({ VERCEL: "1" }, () => {
    for (const url of [undefined, "pglite:", "pglite:/tmp/db"]) assert.throws(() => dbTarget(url), /must point at Postgres when hosted/, String(url));
    assert.equal(dbTarget("postgres://h/db").driver, "neon");
  });
});

test("getDb opens one migrated PGlite database per process when DATABASE_URL is unset", async () => {
  const saved = { ...process.env };
  delete process.env.VERCEL; delete process.env.OPENSRCER_EXECUTION;
  try {
    // A bad URL fails the open, and the failure is not cached.
    process.env.DATABASE_URL = "mysql://localhost/db";
    await assert.rejects(getDb(), /postgres:\/\/ URL or pglite/);
    delete process.env.DATABASE_URL;
    const db = await getDb();
    assert.equal(await getDb(), db);
    assert.deepEqual(await db.select({ n: sql<number>`count(*)::int` }).from(lessons), [{ n: 0 }]);
  } finally { process.env = saved; }
});
