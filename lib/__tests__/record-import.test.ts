// "Import my GitHub history" against a fake GraphQL endpoint, into PGlite.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { contributions, standingEvents, users } from "../db/schema";
import { gh } from "../gh";
import { fetchHistory, GitHubUserNotFoundError, importEvents, importHistory, type MergedPr } from "../record/import";
import { SPAM, spamSignals } from "../record/signals";
import { InvalidLoginError, recordView } from "../record/standing";
import { recordPublished } from "../record/sync";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

const NOW = new Date("2026-10-30T12:00:00Z");
type Pr = { number: number; createdAt: string; mergedAt: string | null; merged: boolean; repository: { nameWithOwner: string; isPrivate: boolean } };
const pr = (repo: string, number: number, createdAt: string, merged: boolean, isPrivate = false): Pr =>
  ({ number, createdAt, mergedAt: merged ? createdAt : null, merged, repository: { nameWithOwner: repo, isPrivate } });

/** GitHub GraphQL: search answers by the query's qualifiers, user by login. */
function fakeGitHub(opts: { merged: Pr[]; opened: Pr[]; contributedTo?: number | null }) {
  const queries: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> };
    let data: unknown;
    if (query.includes("query Contributed(")) {
      data = { user: opts.contributedTo === null ? null : { repositoriesContributedTo: { totalCount: opts.contributedTo ?? 0 } } };
    } else {
      queries.push(variables.q);
      const nodes = variables.q.includes("is:merged") ? opts.merged : opts.opened;
      data = { search: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
    }
    return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { client: gh(`t-${Math.random()}`, { fetch }), queries };
}

test("fetchHistory: public PRs only, the 90-day window in the query, unknown users and bad logins refused", async () => {
  const github = fakeGitHub({
    merged: [pr("pallets/flask", 1, "2026-01-01T00:00:00Z", true), pr("secret/repo", 2, "2026-01-02T00:00:00Z", true, true)],
    opened: [pr("pallets/flask", 3, "2026-10-01T00:00:00Z", false), {} as Pr],
    contributedTo: 4,
  });
  const h = await fetchHistory(github.client, "ada", NOW);
  assert.deepEqual(h.merged, [{ repo: "pallets/flask", number: 1, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T00:00:00Z" }]);
  assert.deepEqual(h.opened, [{ repo: "pallets/flask", createdAt: "2026-10-01T00:00:00Z", merged: false }]);
  assert.equal(h.contributedTo, 4);
  assert.ok(github.queries.includes("is:pr is:public author:ada created:>=2026-08-01"), github.queries.join(" | "));
  await assert.rejects(fetchHistory(fakeGitHub({ merged: [], opened: [], contributedTo: null }).client, "ghost", NOW), GitHubUserNotFoundError);
  for (const bad of ["", "-ada", "a b", "x".repeat(40), "ada author:other"]) await assert.rejects(fetchHistory(github.client, bad, NOW), InvalidLoginError, bad);
});

test("importEvents: half-weight merges not already recorded; one spam flag per burst day", () => {
  const merged: MergedPr[] = [{ repo: "a/x", number: 1, createdAt: "t", mergedAt: "t" }, { repo: "A/X", number: 2, createdAt: "t", mergedAt: "t" }];
  const quiet = spamSignals([]);
  assert.deepEqual(importEvents(merged, new Set(["a/x#2"]), quiet), [{ kind: "imported_merged", ref: "a/x#1", points: 50 }]);
  assert.deepEqual(importEvents([], new Set(), { ...quiet, bursts: [{ day: "2026-10-05", prs: 12, repos: 9 }] }), [{ kind: "spam_flag", ref: "burst:2026-10-05", points: 0 }]);
  assert.deepEqual(importEvents([], new Set(), quiet), []);
});

test("importHistory: records imported merges at half weight up to contributor, keeps a summary, re-import adds nothing", async () => {
  const user = { id: "github|7", login: "ada" };
  // One PR opensrcer already records: imported again it must not count twice.
  await recordPublished(connection.db, { userId: user.id, login: "ada", repoFull: "pallets/flask", prNumber: 5, path: "ai" });
  const merged = [1, 2, 3, 4, 5].map((n) => pr("pallets/flask", n, `2026-0${n}-01T00:00:00Z`, true));
  const github = fakeGitHub({ merged, opened: [pr("pallets/flask", 9, "2026-10-01T00:00:00Z", true)], contributedTo: 2 });
  const summary = await importHistory(connection.db, github.client, user, NOW);
  assert.deepEqual([summary.merged, summary.contributedTo, summary.mergedPerRepo], [5, 2, { "pallets/flask": 5 }]);
  assert.deepEqual(summary.signals, { opened: 1, merged: 1, mergedRatio: 1, bursts: [] });
  const imported = await connection.db.select().from(contributions).where(and(eq(contributions.userId, user.id), eq(contributions.source, "imported")));
  assert.equal(imported.length, 4);
  const view = await recordView(connection.db, user.id);
  assert.equal(view.level, "contributor", "4 imported merges, 1 in the same repo through opensrcer still open: contributor, never regular");
  assert.equal(view.standing, 200);
  assert.deepEqual((view.history as { merged: number }).merged, 5);
  await importHistory(connection.db, github.client, user, NOW);
  assert.equal((await connection.db.select().from(standingEvents).where(eq(standingEvents.userId, user.id))).length, 4, "re-import is idempotent");
});

test("importHistory: a burst raises a spam flag that freezes level-ups", async () => {
  const user = { id: "github|8", login: "burst" };
  const opened = Array.from({ length: SPAM.burstPrs }, (_, i) => pr(`o/r${i % SPAM.burstRepos}`, 100 + i, `2026-10-05T${String(i).padStart(2, "0")}:00:00Z`, false));
  const github = fakeGitHub({ merged: [pr("a/x", 1, "2026-01-01T00:00:00Z", true)], opened, contributedTo: 1 });
  const summary = await importHistory(connection.db, github.client, user, NOW);
  assert.equal(summary.signals.bursts.length, 1);
  const view = await recordView(connection.db, user.id);
  assert.deepEqual(view.spamFlags, ["burst:2026-10-05"]);
  assert.equal(view.level, "contributor", "the merge came first in the batch; the flag stops anything after it");
  const [row] = await connection.db.select().from(users).where(eq(users.id, user.id));
  assert.equal(row.level, 1);
});
