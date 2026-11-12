// The harness's code-map store and build leases (lib/harness-graph.ts) on a real (PGlite)
// database: Postgres first, Blob only as the older store, and an outage of either alone
// never blocks a lesson's map.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openDb, type DbConnection } from "../db/client";
import { migrateDb } from "../db/migrate";
import { cloudLeases, sharedGraphs } from "../db/schema";
import { packGraph, type StoredGraph } from "../graph-worker";
import { GRAPH_SLOTS, reserveGraphSlot, SharedGraphError, storedSharedGraph } from "../harness-graph";
import { CapacityError } from "../concurrency";

let connection: DbConnection;
before(async () => {
  connection = await openDb({ driver: "pglite" });
  await migrateDb(connection);
});
after(() => connection.close());

const graph = (revision: string): StoredGraph => ({ graph: { nodes: [{ id: "fill", label: "fill()", community: 0, file_type: "code", source_file: "app/fill.py" }], links: [] }, html: "<html>map</html>", revision, created_at: "2026-11-12T00:00:00Z" } as StoredGraph);
const SHA = "a".repeat(40);
const blobDown = async () => { throw new Error("Vercel Blob: quota exceeded"); };
const brokenDb = { select: () => { throw new Error("database unreachable"); } } as unknown as DbConnection["db"];

test("a map in Postgres is read from there, matched case-insensitively; Blob isn't asked", async () => {
  await connection.db.insert(sharedGraphs).values({ repo: "acme/app", revision: SHA, data: packGraph(graph(SHA)) });
  let asked = false;
  const got = await storedSharedGraph("Acme/App", connection.db, async () => { asked = true; return null; });
  assert.equal(got?.revision, SHA);
  assert.equal(asked, false);
});

test("not in Postgres: the older Blob store is asked", async () => {
  const got = await storedSharedGraph("acme/old", connection.db, async () => graph("b".repeat(40)));
  assert.equal(got?.revision, "b".repeat(40));
});

test("not in Postgres and Blob is down: no map yet (it gets built), not an error", async () => {
  assert.equal(await storedSharedGraph("acme/new", connection.db, blobDown), null);
});

test("both stores down: a 503 the plugin can show", async () => {
  await assert.rejects(storedSharedGraph("acme/new", brokenDb, blobDown), (e) => e instanceof SharedGraphError && e.status === 503);
});

test("build slots: one per account, GRAPH_SLOTS in all, released and expired ones reused", async () => {
  await connection.db.delete(cloudLeases);
  const t0 = new Date("2026-11-12T12:00:00Z");
  const now = () => t0;
  const a = await reserveGraphSlot(connection.db, "github|1", now);
  await assert.rejects(reserveGraphSlot(connection.db, "github|1", now), (e) => e instanceof CapacityError && /already have a code map building/.test(e.message));
  const b = await reserveGraphSlot(connection.db, "github|2", now);
  assert.equal(GRAPH_SLOTS, 2);
  await assert.rejects(reserveGraphSlot(connection.db, "github|3", now), (e) => e instanceof CapacityError && /All map builders are busy/.test(e.message));
  await a();
  const c = await reserveGraphSlot(connection.db, "github|3", now);
  assert.equal((await connection.db.select().from(cloudLeases)).length, 2, "both slots held again");
  // Functions that died without releasing: their leases run out and a slot is taken over.
  const later = () => new Date(t0.getTime() + 6 * 60_000);
  const d = await reserveGraphSlot(connection.db, "github|4", later); // takes slot 0, c's
  await c(); // c's late release must not free d's slot
  const live = (await connection.db.select().from(cloudLeases)).filter((l) => l.expires > later());
  assert.equal(live.length, 1, "d's lease survives c's late release");
  await b(); await d();
  assert.equal((await connection.db.select().from(cloudLeases)).length, 0);
});
