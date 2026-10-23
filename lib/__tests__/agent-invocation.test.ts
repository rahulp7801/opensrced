import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentInvocation } from "../agent-invocation";
import { ALLOWED_TOOLS, EXEC_TOOLS } from "../claude-tools";
import { CLAUDE_AGENT_MODEL } from "../models";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

test("isolation flags hold with and without --bare", () => {
  for (const key of ["sk-ant-test", undefined]) {
    const { bin, args, env } = buildAgentInvocation({ prompt: "p", mcpConfig: "/m.json", inject: { ANTHROPIC_API_KEY: key } });
    assert.equal(bin, "claude");
    // --bare ignores OAuth, so it is only used when an API key is injected.
    assert.equal(args.includes("--bare"), Boolean(key));
    assert.equal(flag(args, "--setting-sources"), "");
    assert.equal(flag(args, "--tools"), "");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(flag(args, "--allowed-tools"), ALLOWED_TOOLS.join(","));
    assert.equal(flag(args, "--model"), CLAUDE_AGENT_MODEL);
    assert.equal(env.ANTHROPIC_API_KEY, key);
  }
});

test("caps: dollars and turns are both passed, and validated", () => {
  const { args } = buildAgentInvocation({ prompt: "p", mcpConfig: "m", tools: [...ALLOWED_TOOLS, ...EXEC_TOOLS], budgetUsd: 3, maxTurns: 80 });
  assert.equal(flag(args, "--max-budget-usd"), "3");
  assert.equal(flag(args, "--max-turns"), "80");
  assert.match(flag(args, "--allowed-tools"), /run_command/);
  assert.throws(() => buildAgentInvocation({ prompt: "p", mcpConfig: "m", budgetUsd: 0 }), RangeError);
  assert.throws(() => buildAgentInvocation({ prompt: "p", mcpConfig: "m", maxTurns: 1.5 }), RangeError);
});

test("the child env is an allowlist plus explicit injections", () => {
  const saved = process.env.AUTH0_SECRET;
  process.env.AUTH0_SECRET = "must-not-leak";
  try {
    const { env } = buildAgentInvocation({ prompt: "p", mcpConfig: "m", inject: { GITHUB_TOKEN: "t", OPENSRCER_EXEC_URL: undefined } });
    assert.equal(env.AUTH0_SECRET, undefined);
    assert.equal(env.GITHUB_TOKEN, "t");
    assert.ok(!("OPENSRCER_EXEC_URL" in env));
  } finally {
    if (saved === undefined) delete process.env.AUTH0_SECRET; else process.env.AUTH0_SECRET = saved;
  }
});
