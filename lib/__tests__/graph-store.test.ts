import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  GRAPHS_PER_ACCOUNT, GRAPHS_PER_REPO, getSharedGraph, getStoredGraph, hasStoredGraph, localSharedPath,
  saveStoredGraph, sharedGraphPath, staleGraphPaths,
} from "../graph-store";
import { graphJsonPath } from "../graph";
import type { StoredGraph } from "../graph-worker";

test("an account keeps only its newest graphs, whatever order storage lists them in", () => {
  const blobs = Array.from({ length: GRAPHS_PER_ACCOUNT + 3 }, (_, i) => ({ pathname: `g${i}`, uploadedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }));
  const shuffled = [...blobs].reverse();
  // The three oldest (g0..g2) go, the newest twenty stay.
  assert.deepEqual(staleGraphPaths(shuffled).sort(), ["g0", "g1", "g2"]);
  assert.deepEqual(staleGraphPaths(blobs.slice(0, GRAPHS_PER_ACCOUNT)), []);
});

test("sharedGraphPath: one lower-cased path per repository and commit, full SHAs only", () => {
  const sha = "AB".repeat(20);
  assert.equal(sharedGraphPath("Django", "Django", sha), `graphs/django/django/${"ab".repeat(20)}.json.gz`);
  for (const bad of ["", "main", "abc123", "g".repeat(40), `${"a".repeat(40)}/../x`]) assert.throws(() => sharedGraphPath("o", "r", bad), /full commit SHA/, bad);
  assert.throws(() => sharedGraphPath("..", "r", "a".repeat(40)), /valid GitHub repository/);
});

// The local store lives under the home directory, so point it at a temp dir.
const savedEnv = { ...process.env };
let home = "";
before(async () => {
  home = await mkdtemp(join(tmpdir(), "graph-store-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.VERCEL;
  delete process.env.OPENSRCER_EXECUTION;
});
after(async () => {
  process.env = savedEnv;
  await rm(home, { recursive: true, force: true });
});

function graph(revision: string, label = "a"): StoredGraph {
  return {
    graph: { nodes: [{ id: label, label, community: 0, file_type: "code", source_file: `${label}.py` }], links: [] },
    html: `<p>${label}</p>`, revision, created_at: new Date().toISOString(),
  };
}

test("a public repository's graph is shared: readers get it first, at the newest or a pinned commit", async () => {
  const sha = "1".repeat(40);
  await saveStoredGraph("github|1", "Owner/Public", graph(sha, "shared"), "public");
  assert.ok(existsSync(localSharedPath(sharedGraphPath("owner", "public", sha))));
  // The unpacked pair the MCP server reads is still written locally.
  assert.ok(existsSync(graphJsonPath("Owner", "Public")));
  // Another account reads the same graph, with its commit (the local pair has none).
  const read = await getStoredGraph("github|2", "owner/public");
  assert.equal(read?.revision, sha);
  assert.equal(read?.graph.nodes[0].id, "shared");
  assert.equal((await getSharedGraph("owner/public", sha))?.revision, sha);
  assert.equal(await getSharedGraph("owner/public", "2".repeat(40)), null);
  assert.equal(await hasStoredGraph("github|2", "owner/public"), true);
});

test("the shared store keeps the newest commits per repository and points at the latest", async () => {
  const shas = ["a", "b", "c", "d", "e"].map((c) => c.repeat(40));
  for (const sha of shas) {
    await saveStoredGraph("github|1", "owner/busy", graph(sha), "public");
    await new Promise((resolve) => setTimeout(resolve, 25)); // distinct mtimes
  }
  const kept = shas.filter((sha) => existsSync(localSharedPath(sharedGraphPath("owner", "busy", sha))));
  assert.deepEqual(kept, shas.slice(-GRAPHS_PER_REPO));
  assert.equal((await getSharedGraph("owner/busy"))?.revision, shas.at(-1));
});

test("a private repository's graph never reaches the shared store", async () => {
  await saveStoredGraph("github|1", "owner/secret", graph("3".repeat(40), "private"), "private");
  assert.equal(existsSync(dirname(localSharedPath(sharedGraphPath("owner", "secret", "3".repeat(40))))), false);
  assert.equal(await getSharedGraph("owner/secret"), null);
  // The caller's own (local) copy still answers.
  assert.equal((await getStoredGraph("github|1", "owner/secret"))?.graph.nodes[0].id, "private");
  assert.equal(await hasStoredGraph("github|1", "owner/secret"), true);
  assert.equal(await hasStoredGraph("github|1", "owner/never-built"), false);
  assert.equal(await getStoredGraph("github|1", "owner/never-built"), null);
});

test("shared graph failures: bad SHA, corrupt pointer, invalid graph", async () => {
  await assert.rejects(getSharedGraph("owner/public", "main"), /full commit SHA/);
  const pointer = localSharedPath("graphs/owner/corrupt/latest.json");
  await mkdir(dirname(pointer), { recursive: true });
  await writeFile(pointer, JSON.stringify({ revision: "../../etc" }));
  await assert.rejects(getSharedGraph("owner/corrupt"), /Invalid shared graph pointer/);
  await assert.rejects(hasStoredGraph("github|1", "owner/corrupt"), /Invalid shared graph pointer/);
  await assert.rejects(saveStoredGraph("github|1", "owner/public", graph("main"), "public"), /Invalid graph output|full commit SHA/);
  await assert.rejects(saveStoredGraph("github|1", "not a repo", graph("4".repeat(40)), "public"), /valid GitHub repository/);
});
