import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// In-memory stand-ins for the Blob and Sandbox SDKs, installed in the module
// cache before the capacity code loads. node --test runs each file in its own
// process, so nothing leaks into other tests.
const store = new Map<string, { body: string; etag: string }>();
let etags = 0;
class BlobPreconditionFailedError extends Error {}
class BlobNotFoundError extends Error {}
const fakeBlob = {
  BlobPreconditionFailedError,
  BlobNotFoundError,
  async get(path: string) {
    const entry = store.get(path);
    return entry ? { statusCode: 200, stream: entry.body, blob: { size: entry.body.length, etag: entry.etag } } : null;
  },
  async put(path: string, body: string, opts: { allowOverwrite?: boolean; ifMatch?: string } = {}) {
    const entry = store.get(path);
    if (opts.ifMatch && entry?.etag !== opts.ifMatch) throw new BlobPreconditionFailedError("etag mismatch");
    if (entry && !opts.allowOverwrite) throw new Error("This blob already exists");
    store.set(path, { body, etag: String(++etags) });
    return { pathname: path };
  },
  async list() { return { blobs: [] }; },
  async del() {},
  async head() { throw new BlobNotFoundError(); },
};
const stopped: string[] = [];
class APIError extends Error { response = { status: 500 }; }
const fakeSandbox = {
  APIError,
  Sandbox: { async get({ name }: { name: string }) { return { status: "running", async stop() { stopped.push(name); } }; } },
};
const req = createRequire(__filename);
for (const [id, fake] of [["@vercel/blob", fakeBlob], ["@vercel/sandbox", fakeSandbox], ["@vercel/blob/client", {}]] as const) {
  const resolved = req.resolve(id);
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fake } as never;
}

async function load() {
  const runs = await import("../cloud-runs");
  const state = await import("../cloud-run-state");
  const slots = await import("../cloud-capacity");
  return { ...runs, ...state, ...slots };
}

async function seed(slot: number, owner: string, status: "running" | "failed", sandboxStopped = false, forgedName?: string) {
  const { newCloudRunId, runPath } = await load();
  const id = newCloudRunId();
  const path = runPath(owner, id);
  const expires = Date.now() + 60_000;
  store.set(path, { etag: String(++etags), body: JSON.stringify({
    id, auth0_user_id: owner, status, expires_at: expires, sandbox_name: forgedName ?? id.replaceAll("_", "-"),
    ...(sandboxStopped ? { sandbox_stopped: true } : {}),
  }) });
  store.set(`capacity/${slot}.json`, { etag: String(++etags), body: JSON.stringify({ path, expires, reserved: Date.now() }) });
  return id.replaceAll("_", "-");
}

test("one account cannot hold every agent slot", async () => {
  const { reserveCapacity, runPath, newCloudRunId } = await load();
  store.clear();
  await seed(0, "auth0|alice", "running");
  await seed(1, "auth0|alice", "running");
  await assert.rejects(reserveCapacity(runPath("auth0|alice", newCloudRunId()), Date.now() + 60_000), /already have 2 runs/);
  // Someone else still gets the free slot.
  assert.equal(await reserveCapacity(runPath("auth0|bob", newCloudRunId()), Date.now() + 60_000), "capacity/2.json");
});

test("reusing a finished run's slot stops its idle VM", async () => {
  const { reserveCapacity, runPath, newCloudRunId } = await load();
  store.clear();
  stopped.length = 0;
  // The record names another VM (a worker can rewrite its own record); the
  // stop must still target the VM derived from the lease's run id.
  const idle = await seed(0, "auth0|alice", "failed", false, "c-1767225600000-victimvictim1");
  await seed(1, "auth0|dana", "running");
  await seed(2, "auth0|erin", "running");
  assert.equal(await reserveCapacity(runPath("auth0|carol", newCloudRunId()), Date.now() + 60_000), "capacity/0.json");
  assert.deepEqual(stopped, [idle]);

  // An already-stopped VM is not stopped again.
  store.clear();
  stopped.length = 0;
  await seed(0, "auth0|alice", "failed", true);
  await reserveCapacity(runPath("auth0|carol", newCloudRunId()), Date.now() + 60_000);
  assert.deepEqual(stopped, []);
});

test("simultaneous requests cannot slip past the per-account caps", async () => {
  const { reserveCapacity, runPath, newCloudRunId, reserveCloudSlot } = await load();
  store.clear();
  const runs = await Promise.allSettled([0, 1, 2].map(() => reserveCapacity(runPath("auth0|alice", newCloudRunId()), Date.now() + 60_000)));
  assert.ok(runs.filter(r => r.status === "fulfilled").length <= 2, "at most two agent slots for one account");
  const slots = await Promise.allSettled([0, 1, 2].map(() => reserveCloudSlot("explore", 3, 60_000, "auth0|alice")));
  assert.ok(slots.filter(r => r.status === "fulfilled").length <= 1, "at most one explore slot for one account");
  // Someone else is never locked out by the race.
  assert.ok(await reserveCloudSlot("explore", 3, 60_000, "auth0|bob"));
});

test("short-task slots allow one per account", async () => {
  const { reserveCloudSlot } = await load();
  store.clear();
  const release = await reserveCloudSlot("graph", 2, 60_000, "auth0|alice");
  await assert.rejects(reserveCloudSlot("graph", 2, 60_000, "auth0|alice"), /already have a graph task/);
  const other = await reserveCloudSlot("graph", 2, 60_000, "auth0|bob");
  await assert.rejects(reserveCloudSlot("graph", 2, 60_000, "auth0|carol"), /All workers are busy/);
  await release();
  await reserveCloudSlot("graph", 2, 60_000, "auth0|alice");
  await other();
});
