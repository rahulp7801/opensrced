import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("org access is re-verified: removed admins lose it, outages only deny", async (t) => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-org-admin-"));
  process.chdir(root);
  try {
    const store = await import("../crucible/orgs");
    const { stillOrgAdmin } = await import("../crucible/org-admin");
    const save = (user: string, org: string, id: number) => store.saveMapping({
      auth0_user_id: user, github_org: org, installation_id: id, installer: user, verified_at: new Date().toISOString(),
    });
    await save("alice", "acme", 1);
    await save("bob", "demoted", 2);
    await save("carol", "flaky", 3);

    let membership: { status: number; body: unknown } = { status: 200, body: { role: "admin", state: "active" } };
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      calls++;
      if (url.endsWith("/user")) return Response.json({ login: "someone" });
      return Response.json(membership.body, { status: membership.status });
    });

    assert.equal(await stillOrgAdmin("alice", "acme", "token"), true);
    const afterFirst = calls;
    assert.equal(await stillOrgAdmin("alice", "acme", "token"), true);
    assert.equal(calls, afterFirst, "a confirmed admin is cached");

    membership = { status: 200, body: { role: "member", state: "active" } };
    assert.equal(await stillOrgAdmin("bob", "demoted", "token"), false);
    assert.equal(await store.mappingForOrg("bob", "demoted"), null, "a definite demotion disconnects");

    membership = { status: 502, body: {} };
    assert.equal(await stillOrgAdmin("carol", "flaky", "token"), false);
    assert.ok(await store.mappingForOrg("carol", "flaky"), "an outage denies without disconnecting");

    assert.equal(await stillOrgAdmin("carol", "flaky", null), false, "no GitHub identity, no access");
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
});
