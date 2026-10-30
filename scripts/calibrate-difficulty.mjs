// How well difficulty v2 ranks real fix sizes (PLAN.md §6.3): for every
// ingested issue closed by a merged PR, recompute its difficulty from its
// stored features and the solved issues closed before it was opened (never
// itself, never a later fix), then report Spearman ρ against the real fix
// size (lines added + deleted) and files touched.
//
//   npm run calibrate:difficulty            # all catalog repos
//   npm run calibrate:difficulty -- pallets/click
//
// Tune lib/recs/weights.ts DIFFICULTY, rerun, keep what raises ρ.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dbTarget, openDb } = require("../.test-build/lib/db/client.js");
const { migrateDb } = require("../.test-build/lib/db/migrate.js");
const { scoreDifficulty, spearman } = require("../.test-build/lib/recs/difficulty.js");
const { similarIssues, rowsOf } = require("../.test-build/lib/recs/similar.js");
const { DIFFICULTY } = require("../.test-build/lib/recs/weights.js");
const { sql } = require("drizzle-orm");

const only = process.argv[2]?.toLowerCase();
const connection = await openDb(dbTarget());
try {
  if (connection.driver === "pglite") await migrateDb(connection);
  const { db } = connection;
  const solved = rowsOf(await db.execute(sql`
    select i.repo_id as "repoId", r.owner, r.name, r.language, i.number, i.title, i.body_excerpt as body,
      i.embedding::text as embedding, i.scope_nodes as "scopeNodes", i.features, i.created_at as "createdAt",
      i.closed_at as "closedAt", i.fix_files as "fixFiles", i.fix_add + i.fix_del as lines
    from issues i join repos r on r.id = i.repo_id
    where i.state = 'closed' and i.closing_pr is not null and i.features is not null
    order by r.owner, r.name, i.number`)).filter((row) => !only || `${row.owner}/${row.name}`.toLowerCase() === only);
  if (solved.length < 3) throw new Error(`Only ${solved.length} solved issues with fixes; ingest more repos first.`);

  const full = [], noPrior = [], lines = [], files = [];
  let withPrior = 0;
  for (const row of solved) {
    const neighbours = await similarIssues(db, {
      repoId: row.repoId, number: row.number, language: row.language, title: row.title, body: row.body,
      embedding: row.embedding ? JSON.parse(row.embedding) : null, scopeNodes: row.scopeNodes ?? [],
    }, { limit: DIFFICULTY.neighbours, closedBefore: new Date(row.createdAt) });
    // Age at the time it was solved, the closest stand-in for "when it was recommended".
    const ageDays = (new Date(row.closedAt) - new Date(row.createdAt)) / 86_400_000;
    full.push(scoreDifficulty(row.features, ageDays, neighbours).score);
    noPrior.push(scoreDifficulty(row.features, ageDays, []).score);
    if (neighbours.length >= DIFFICULTY.minNeighbours) withPrior++;
    lines.push(Number(row.lines));
    files.push(Number(row.fixFiles));
  }
  const rho = (xs, ys) => spearman(xs, ys).toFixed(3);
  const repos = [...new Set(solved.map((row) => `${row.owner}/${row.name}`))];
  console.log(`Difficulty v2 calibration over ${solved.length} solved issues in ${repos.join(", ")}`);
  console.log(`  with an outcome prior (≥ ${DIFFICULTY.minNeighbours} earlier solved neighbours): ${withPrior}`);
  console.log(`  Spearman ρ vs lines changed: ${rho(full, lines)}   (features only, no prior: ${rho(noPrior, lines)})`);
  console.log(`  Spearman ρ vs files touched: ${rho(full, files)}   (features only, no prior: ${rho(noPrior, files)})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await connection.close();
}
