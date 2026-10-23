import { test } from "node:test";
import assert from "node:assert/strict";
import { agentSlots, hostedExecLimits } from "../limits";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { process.env = saved; }
}

test("hosted exec is off unless OPENSRCER_HOSTED_EXEC is exactly 1, and its caps fit the 40-minute VM", () => {
  for (const value of [undefined, "", "0", "true", "yes"]) assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC: value }, () => hostedExecLimits().enabled), false, String(value));
  const on = withEnv({ OPENSRCER_HOSTED_EXEC: "1", OPENSRCER_HOSTED_EXEC_SETUP_MS: undefined, OPENSRCER_HOSTED_EXEC_AGENT_MS: undefined, OPENSRCER_HOSTED_EXEC_CMD_TIMEOUT_MS: undefined }, hostedExecLimits);
  assert.deepEqual(on, { enabled: true, setupMs: 8 * 60_000, agentMs: 20 * 60_000, cmdTimeoutMs: 5 * 60_000 });
  assert.ok(on.setupMs + on.agentMs < 40 * 60_000);
});

test("hosted exec knobs: valid values apply, malformed ones fall back instead of turning a cap off", () => {
  assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC_AGENT_MS: "60000" }, () => hostedExecLimits().agentMs), 60_000);
  for (const bad of ["0", "-5", "abc", " "]) assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC_SETUP_MS: bad }, () => hostedExecLimits().setupMs), 8 * 60_000, bad);
});

test("agentSlots: 3 runs, 2 when each run holds an exec VM too, overridable, never 0", () => {
  assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC: undefined, OPENSRCER_AGENT_SLOTS: undefined }, agentSlots), 3);
  assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC: "1", OPENSRCER_AGENT_SLOTS: undefined }, agentSlots), 2);
  assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC: "1", OPENSRCER_AGENT_SLOTS: "4" }, agentSlots), 4);
  assert.equal(withEnv({ OPENSRCER_HOSTED_EXEC: undefined, OPENSRCER_AGENT_SLOTS: "0" }, agentSlots), 3);
});
