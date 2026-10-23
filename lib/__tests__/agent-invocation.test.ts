import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentInvocation } from "../agent-invocation";
import { ALLOWED_TOOLS, EXEC_TOOLS } from "../claude-tools";
import { CLAUDE_AGENT_MODEL } from "../models";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

test("isolation flags hold for key runs (--bare) and subscription runs (no --bare)", () => {
  const key = buildAgentInvocation({ prompt: "p", mcpConfig: "/m.json", maxTurns: 5, budgetUsd: 2, inject: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  const plan = buildAgentInvocation({ prompt: "p", mcpConfig: "/m.json", maxTurns: 5, budgetUsd: 2 });
  assert.equal(key.provider, "anthropic-key");
  assert.equal(plan.provider, "claude-subscription");
  assert.ok(key.args.includes("--bare"));
  assert.ok(!plan.args.includes("--bare"), "--bare would ignore the subscription login");
  assert.ok(plan.args.includes("--disable-slash-commands"));
  for (const { bin, args } of [key, plan]) {
    assert.equal(bin, "claude");
    assert.equal(flag(args, "--setting-sources"), "");
    assert.equal(flag(args, "--tools"), "");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(flag(args, "--allowed-tools"), ALLOWED_TOOLS.join(","));
    assert.equal(flag(args, "--model"), CLAUDE_AGENT_MODEL);
    assert.equal(flag(args, "--max-turns"), "5");
  }
  assert.equal(key.env.ANTHROPIC_API_KEY, "sk-ant-test");
  // Regression: a non-blocking MCP connect left real runs with zero tools.
  for (const { env } of [key, plan]) assert.equal(env.MCP_CONNECTION_NONBLOCKING, "0");
  assert.equal(flag(key.args, "--max-budget-usd"), "2");
  assert.ok(!plan.args.includes("--max-budget-usd"), "a plan run has no per-token cost to cap");
  assert.equal(plan.capLabel, "--max-turns=5");
});

test("subscription runs never carry a credential and always carry a turn cap", () => {
  const saved = process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const plan = buildAgentInvocation({ provider: "claude-subscription", prompt: "p", mcpConfig: "m", maxTurns: 60, inject: { ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "tok" } });
    assert.equal(plan.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, undefined);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved;
  }
  assert.throws(() => buildAgentInvocation({ provider: "claude-subscription", prompt: "p", mcpConfig: "m" }), /turn cap/);
  assert.throws(() => buildAgentInvocation({ provider: "anthropic-key", prompt: "p", mcpConfig: "m", maxTurns: 1 }), /ANTHROPIC_API_KEY/);
});

test("caps and tools are validated", () => {
  const { args } = buildAgentInvocation({ prompt: "p", mcpConfig: "m", tools: [...ALLOWED_TOOLS, ...EXEC_TOOLS], maxTurns: 80, inject: { ANTHROPIC_API_KEY: "k" } });
  assert.match(flag(args, "--allowed-tools"), /run_command/);
  assert.throws(() => buildAgentInvocation({ prompt: "p", mcpConfig: "m", budgetUsd: 0, maxTurns: 1 }), RangeError);
  assert.throws(() => buildAgentInvocation({ prompt: "p", mcpConfig: "m", maxTurns: 1.5 }), RangeError);
});

test("the child env is an allowlist plus explicit injections", () => {
  const saved = process.env.AUTH0_SECRET;
  process.env.AUTH0_SECRET = "must-not-leak";
  try {
    const { env } = buildAgentInvocation({ prompt: "p", mcpConfig: "m", maxTurns: 1, inject: { GITHUB_TOKEN: "t", OPENSRCER_EXEC_URL: undefined } });
    assert.equal(env.AUTH0_SECRET, undefined);
    assert.equal(env.GITHUB_TOKEN, "t");
    assert.ok(!("OPENSRCER_EXEC_URL" in env));
  } finally {
    if (saved === undefined) delete process.env.AUTH0_SECRET; else process.env.AUTH0_SECRET = saved;
  }
});
