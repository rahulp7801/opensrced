// Applies the drizzle/ migrations. `npm run db:migrate` runs this file against
// DATABASE_URL (see client.ts for the accepted values); tests and getDb()'s
// PGlite call migrateDb() on a connection they already hold.
//
//   npx drizzle-kit generate   # after changing lib/db/schema.ts
//   npm run db:migrate         # reads DATABASE_URL from .env.local if present

import { join } from "node:path";
import { openDb, type DbConnection } from "./client";

/** Written by drizzle-kit (drizzle.config.ts). Resolved from the working
 *  directory: `next dev`, `npm test` and `npm run db:migrate` all run at the root. */
export const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

export async function migrateDb(connection: DbConnection): Promise<void> {
  const config = { migrationsFolder: MIGRATIONS_DIR };
  if (connection.driver === "pglite") await (await import("drizzle-orm/pglite/migrator")).migrate(connection.db, config);
  else await (await import("drizzle-orm/neon-serverless/migrator")).migrate(connection.db, config);
}

if (require.main === module) {
  openDb()
    .then((connection) => migrateDb(connection).finally(() => connection.close()))
    .then(
      () => console.log("Database migrated."),
      (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; },
    );
}
