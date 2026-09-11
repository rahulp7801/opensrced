import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyProbe, hasBin } from "../health";

test("500 simultaneous health requests share a probe and cache its result", async () => {
  let calls = 0;
  const deps = { claude: true, gh: true, git: true, patch: true, gitleaks: true, mcp_server_built: true };
  const get = dependencyProbe(async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return deps;
  });
  const results = await Promise.all(Array.from({ length: 500 }, () => get()));
  assert.equal(calls, 1);
  assert.ok(results.every((result) => result === deps));
  assert.equal(await get(), deps);
  assert.equal(calls, 1);
});

test("failed probes can retry and expired probes refresh", async () => {
  let calls = 0;
  const deps = { claude: false, gh: false, git: false, patch: false, gitleaks: false, mcp_server_built: false };
  const get = dependencyProbe(async () => {
    if (++calls === 1) throw new Error("probe failed");
    return deps;
  }, 0);
  await assert.rejects(get(), /probe failed/);
  assert.equal(await get(), deps);
  assert.equal(await get(), deps);
  assert.equal(calls, 3);
});

test("binary probes report present and missing executables", async () => {
  assert.equal(await hasBin(process.execPath), true);
  assert.equal(await hasBin("opensrcer-nonexistent-tool"), false);
});
