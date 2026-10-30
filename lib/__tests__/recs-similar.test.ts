// Hybrid similar-issues search on PGlite with seeded issues and vectors.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { EMBEDDING_DIMENSIONS, issues, repos } from "../db/schema";
import { IssueNotIndexedError, pgTextArray, probeFor, similarIssues, similarToIssue, type SimilarProbe } from "../recs/similar";

let connection: DbConnection;
let click: number, attrs: number, other: number, notCatalog: number;

/** A unit vector along `axis`, nudged toward `toward` by `weight`. */
function vec(axis: number, toward?: number, weight = 0): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[axis] = 1;
  if (toward !== undefined) v[toward] = weight;
  return v;
}

before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
  const { db } = connection;
  [click, attrs, other, notCatalog] = (await db.insert(repos).values([
    { owner: "pallets", name: "click", language: "Python", catalog: true },
    { owner: "python-attrs", name: "attrs", language: "Python", catalog: true },
    { owner: "rust-lang", name: "regex", language: "Rust", catalog: true },
    { owner: "someone", name: "pyproj", language: "Python", catalog: false },
  ]).returning()).map((row) => row.id);
  const closed = (repoId: number, number: number, title: string, body: string, extra: Partial<typeof issues.$inferInsert> = {}) => ({
    repoId, number, title, bodyExcerpt: body, state: "closed" as const, createdAt: new Date("2025-01-01T00:00:00Z"),
    closedAt: new Date("2025-06-01T00:00:00Z"), closingPr: number + 1000, fixFiles: 2, fixAdd: 14, fixDel: 3, reviewRounds: 1, mergeHours: 48, ...extra,
  });
  await db.insert(issues).values([
    // The issue we match against: open, in click.
    { repoId: click, number: 1, title: "Option help text wraps at a hyphen", bodyExcerpt: "HelpFormatter.write_usage splits option names at hyphens", state: "open", createdAt: new Date("2026-01-01T00:00:00Z"), embedding: vec(0), scopeNodes: ["formatting.write_usage", "file:formatting.py"] },
    closed(click, 10, "Usage line breaks long option names at hyphens", "write_usage wraps text badly", { embedding: vec(0, 1, 0.2), scopeNodes: ["formatting.write_usage", "file:formatting.py"] }),
    closed(click, 11, "Progress bar flickers on Windows", "the terminal redraw is slow", { embedding: vec(5), scopeNodes: ["file:termui.py"] }),
    // Closed without a merged PR: never a worked example.
    closed(click, 12, "Help text wraps at hyphen in option", "write_usage hyphen", { closingPr: null, embedding: vec(0) }),
    // Another catalog repo in the same language, a close match.
    closed(attrs, 20, "Help text wrapping splits names at hyphens", "formatter wraps option names", { embedding: vec(0, 1, 0.1), closedAt: new Date("2024-01-01T00:00:00Z") }),
    // Wrong language, and outside the catalog: both excluded.
    closed(other, 30, "Help text wraps at a hyphen", "write_usage hyphen", { embedding: vec(0) }),
    closed(notCatalog, 40, "Help text wraps at a hyphen", "write_usage hyphen", { embedding: vec(0) }),
    // In click, no embedding: still found by text.
    closed(click, 13, "Hyphenated option names wrap in usage", "help usage hyphen wrap", {}),
  ]);
});
after(() => connection.close());

test("pgTextArray quotes every element", () => {
  assert.equal(pgTextArray(["a", 'b"c', "d,e", "f\\g"]), '{"a","b\\"c","d,e","f\\\\g"}');
  assert.equal(pgTextArray([]), "{}");
});

test("similarToIssue: same repo first, merged fixes only, catalog and language respected", async () => {
  const examples = await similarToIssue(connection.db, "pallets", "click", 1, { limit: 10 });
  const keys = examples.map((example) => `${example.repo}#${example.number}`);
  assert.equal(keys[0], "pallets/click#10");
  assert.ok(keys.includes("pallets/click#13"), "text-only match found");
  assert.ok(keys.includes("python-attrs/attrs#20"), "same-language catalog repo included");
  assert.ok(keys.indexOf("python-attrs/attrs#20") > keys.indexOf("pallets/click#13"), "same repo before other repos");
  for (const excluded of ["pallets/click#1", "pallets/click#12", "rust-lang/regex#30", "someone/pyproj#40", "pallets/click#11"]) {
    assert.ok(!keys.includes(excluded), `${excluded} excluded`);
  }
  const best = examples[0];
  assert.deepEqual(
    { prUrl: best.prUrl, url: best.url, fixFiles: best.fixFiles, fixAdd: best.fixAdd, fixDel: best.fixDel, sameRepo: best.sameRepo },
    { prUrl: "https://github.com/pallets/click/pull/1010", url: "https://github.com/pallets/click/issues/10", fixFiles: 2, fixAdd: 14, fixDel: 3, sameRepo: true },
  );
  assert.ok(best.signals.cosine > 0.9 && best.signals.overlap === 1 && best.signals.text > 0);
  assert.ok(best.score > 0.8 && best.score <= 1);
});

test("similarIssues: works without an embedding or scope nodes (weights renormalise)", async () => {
  const probe: SimilarProbe = { repoId: click, language: "Python", title: "option help wraps at hyphen", body: "write_usage", embedding: null, scopeNodes: [] };
  const examples = await similarIssues(connection.db, probe);
  assert.ok(examples.length > 0);
  assert.ok(examples.every((example) => example.signals.cosine === 0 && example.signals.overlap === 0));
  // Text alone carries the whole score now, so the best text match scores 1.
  assert.equal(examples[0].score, 1);
});

test("similarIssues: closedBefore keeps later fixes out; limit bounds the list", async () => {
  const probe = await probeFor(connection.db, "pallets", "click", 1);
  const early = await similarIssues(connection.db, probe, { closedBefore: new Date("2025-01-01T00:00:00Z"), limit: 10 });
  assert.deepEqual(early.map((example) => `${example.repo}#${example.number}`), ["python-attrs/attrs#20"]);
  assert.equal((await similarIssues(connection.db, probe, { limit: 1 })).length, 1);
  for (const bad of [0, 51, 1.5]) await assert.rejects(similarIssues(connection.db, probe, { limit: bad }), RangeError);
});

test("similarIssues: unrelated text finds nothing above the threshold", async () => {
  const probe: SimilarProbe = { repoId: click, language: "Python", title: "zzz qqq", body: "", embedding: null, scopeNodes: [] };
  assert.deepEqual(await similarIssues(connection.db, probe), []);
});

test("probeFor: case-insensitive names; an unknown issue or repo throws IssueNotIndexedError", async () => {
  const probe = await probeFor(connection.db, "Pallets", "CLICK", 1);
  assert.equal(probe.repoId, click);
  assert.equal(probe.embedding?.length, EMBEDDING_DIMENSIONS);
  assert.deepEqual(probe.scopeNodes, ["formatting.write_usage", "file:formatting.py"]);
  await assert.rejects(probeFor(connection.db, "pallets", "click", 999), IssueNotIndexedError);
  await assert.rejects(similarToIssue(connection.db, "nobody", "nothing", 1), IssueNotIndexedError);
});
