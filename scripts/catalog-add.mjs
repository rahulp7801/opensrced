// Mark repos as part of the recommendations catalog (PLAN.md §6.1), and
// optionally ingest them right away instead of waiting for the nightly cron.
//
//   npm run catalog:add -- pallets/click python-attrs/attrs [--ingest]
//   npm run catalog:add -- --remove pallets/click
//
// Uses DATABASE_URL like the app (.env.local is read). In-memory PGlite is
// refused: the rows would vanish when this script exits; use pglite:<dir>.
// Reads GitHub with OPENSRCER_INGEST_GITHUB_TOKEN, else GITHUB_TOKEN
// (e.g. GITHUB_TOKEN=$(gh auth token)). Read-only on GitHub.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Compiled by `tsc -p tsconfig.test.json`, which the npm script runs first.
const { dbTarget, openDb } = require("../.test-build/lib/db/client.js");
const { migrateDb } = require("../.test-build/lib/db/migrate.js");
const { gh } = require("../.test-build/lib/gh.js");
const { addToCatalog, ingestRepo } = require("../.test-build/lib/recs/ingest.js");
const { repos } = require("../.test-build/lib/db/schema.js");
const { and, eq } = require("drizzle-orm");

const args = process.argv.slice(2);
const ingest = args.includes("--ingest");
const remove = args.includes("--remove");
const names = args.filter((arg) => !arg.startsWith("--"));
if (!names.length) {
  console.error("Usage: npm run catalog:add -- owner/name [owner/name…] [--ingest | --remove]");
  process.exit(2);
}

const target = dbTarget();
if (target.driver === "pglite" && !target.dataDir) {
  console.error("DATABASE_URL is unset or in-memory PGlite; set DATABASE_URL=pglite:./.pglite (or a Neon URL).");
  process.exit(2);
}
const token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
if (!token && !remove) {
  console.error("Set OPENSRCER_INGEST_GITHUB_TOKEN or GITHUB_TOKEN to read GitHub.");
  process.exit(2);
}

const connection = await openDb(target);
try {
  // Neon is migrated by `npm run db:migrate` before a deploy; a local PGlite
  // directory is migrated here, as getDb() would.
  if (connection.driver === "pglite") await migrateDb(connection);
  const { db } = connection;
  for (const name of names) {
    if (remove) {
      const [owner, repo] = name.split("/");
      const rows = await db.update(repos).set({ catalog: false }).where(and(eq(repos.owner, owner), eq(repos.name, repo))).returning();
      console.log(rows.length ? `${name}: removed from the catalog` : `${name}: not in the database`);
      continue;
    }
    const row = await addToCatalog(db, gh(token), name);
    console.log(`${row.owner}/${row.name}: in the catalog (${row.language ?? "no language"}, ★${row.stars})`);
    if (ingest) {
      const started = Date.now();
      const result = await ingestRepo(db, gh(token), row);
      console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await connection.close();
}
