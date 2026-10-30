// Database client (PLAN.md §4.2 F1). Production talks to Neon over its
// serverless driver (WebSocket Pool, so transactions work the same as
// locally). Dev and tests run PGlite, Postgres compiled to WASM, in process:
// no Postgres server to install, and the same SQL, pgvector included.
//
//   DATABASE_URL unset, "pglite:" or "pglite:memory"  → in-memory PGlite
//   DATABASE_URL=pglite:<dir>                          → PGlite persisted in <dir>
//   DATABASE_URL=postgres://… (Neon's pooled URL)       → Neon
//
// Hosted (Vercel or the sandbox runtime) refuses PGlite: an in-memory database
// per instance would silently drop every write.

import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { cloudExecution } from "../cloud-run-state";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbTarget = { driver: "neon"; url: string } | { driver: "pglite"; dataDir?: string };
export type DbConnection = { close(): Promise<void> } & (
  | { driver: "neon"; db: NeonDatabase<typeof schema> }
  | { driver: "pglite"; db: PgliteDatabase<typeof schema> }
);

export function dbTarget(url = process.env.DATABASE_URL): DbTarget {
  if (url && /^postgres(ql)?:\/\//.test(url)) return { driver: "neon", url };
  if (url && !url.startsWith("pglite:")) throw new Error("DATABASE_URL must be a postgres:// URL or pglite:[dir]");
  if (cloudExecution()) throw new Error("DATABASE_URL must point at Postgres when hosted");
  const dataDir = url?.slice("pglite:".length);
  return dataDir && dataDir !== "memory" ? { driver: "pglite", dataDir } : { driver: "pglite" };
}

/** A new connection; whoever opens one closes it. The app uses getDb(). */
export async function openDb(target: DbTarget = dbTarget()): Promise<DbConnection> {
  if (target.driver === "neon") {
    const pool = new Pool({ connectionString: target.url });
    return { driver: "neon", db: drizzleNeon({ client: pool, schema, casing: "snake_case" }), close: () => pool.end() };
  }
  // Loaded only here, so a hosted bundle never pulls in the WASM build.
  const [{ PGlite }, { vector }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"), import("@electric-sql/pglite-pgvector"), import("drizzle-orm/pglite"),
  ]);
  const client = await PGlite.create(target.dataDir, { extensions: { vector } });
  return { driver: "pglite", db: drizzle({ client, schema, casing: "snake_case" }), close: () => client.close() };
}

let shared: Promise<Db> | undefined;

/** The app's database, opened once per instance. PGlite is migrated on first
 *  use, since an in-memory database starts empty; Neon is migrated by
 *  `npm run db:migrate` before a deploy, never by a request. */
export function getDb(): Promise<Db> {
  if (!shared) {
    shared = openDb().then(async (connection) => {
      if (connection.driver === "pglite") await (await import("./migrate")).migrateDb(connection);
      return connection.db;
    });
    // A failed open is retried by the next caller instead of cached.
    shared.catch(() => { shared = undefined; });
  }
  return shared;
}
