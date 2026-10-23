import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_EGRESS, EXPLORE_EGRESS, SUBSCRIPTION_AGENT_EGRESS } from "../sandbox-egress";

const hosts = (policy: unknown) => (policy as { allow: string[] }).allow;

test("subscription runs add exactly Anthropic's sign-in hosts to the agent allowlist", () => {
  const added = hosts(SUBSCRIPTION_AGENT_EGRESS).filter((host) => !hosts(AGENT_EGRESS).includes(host));
  assert.deepEqual(added.sort(), ["claude.ai", "platform.claude.com"]);
  for (const host of hosts(AGENT_EGRESS)) assert.ok(hosts(SUBSCRIPTION_AGENT_EGRESS).includes(host), host);
});

test("API-key runs and exploration do not gain the sign-in hosts", () => {
  for (const policy of [AGENT_EGRESS, EXPLORE_EGRESS]) {
    assert.ok(!hosts(policy).includes("claude.ai"));
    assert.ok(!hosts(policy).includes("platform.claude.com"));
    assert.ok(!hosts(policy).some((host) => host === "*" || host.startsWith("*.claude")), "no wildcard Anthropic hosts");
  }
});
