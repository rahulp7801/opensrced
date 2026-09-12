import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

test("disconnect affects only the caller while uninstall removes all installation mappings", async () => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-orgs-"));
  process.chdir(root);
  try {
    const store = await import("../crucible/orgs");
    for (const owner of ["alice", "bob"]) {
      for (const [org, id] of [["shared", 10], ["other", 20]] as const) {
        await store.saveMapping({ auth0_user_id: owner, github_org: org, installation_id: id, installer: owner, verified_at: new Date().toISOString() });
      }
    }
    await store.deleteMappingsForUser("alice", 10);
    assert.equal(await store.mappingForOrg("alice", "shared"), null);
    assert.ok(await store.mappingForOrg("bob", "shared"));
    assert.equal((await store.listOrgsFor("alice")).length, 1);
    await store.deleteMappingsForUser("alice");
    assert.equal((await store.listOrgsFor("alice")).length, 0);
    assert.equal((await store.listOrgsFor("bob")).length, 2);
    await assert.rejects(store.deleteMappingsForUser(""), /identity/);
    await assert.rejects(store.saveMapping({ auth0_user_id: "mallory\nadmin", github_org: "../other", installation_id: -1, installer: "bad/name", verified_at: "never" }), /Invalid organization mapping/);
    await store.deleteByInstallationId(10);
    assert.equal(await store.mappingForOrg("bob", "shared"), null);
    assert.ok(await store.mappingForOrg("bob", "other"));
  } finally {
    process.chdir(original);
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("opensrcer-orgs-"));
    rmSync(root, { recursive: true, force: true });
  }
});
