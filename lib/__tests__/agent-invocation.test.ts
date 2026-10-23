import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentInvocationError, buildAgentInvocation, resolveMcpServers, StandInAgentError, type AgentInvocationInput } from "../agent-invocation";
import { ALLOWED_TOOLS, EXEC_TOOLS } from "../claude-tools";
import { CLAUDE_AGENT_MODEL } from "../models";

function withConfig(run: (config: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-invocation-test-"));
  try {
    const config = join(dir, ".mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { "opensrcer-repo-tools": { command: "node", args: ["./mcp-server/dist/server.js"] } } }));
    run(config);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function input(config: string, extra: Partial<AgentInvocationInput>): AgentInvocationInput {
  return {
    provider: "claude-subscription", prompt: "Fix it", mcpConfig: config,
    inject: { OPENSRCER_ALLOWED_REPO: "acme/app", GITHUB_TOKEN: "test-github-token" },
    budgetUsd: 2, maxTurns: 40, ...extra,
  };
}

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("a subscription run drops --bare and every API credential, and caps by turns", () => {
  withConfig((config) => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.CLAUDE_CODE_OAUTH_TOKEN };
    process.env.ANTHROPIC_API_KEY = "host-key-must-not-leak";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "host-token-must-not-leak";
    try {
      const run = buildAgentInvocation(input(config, {
        anthropicKey: "user-key-for-fallback-only",
        inject: { OPENSRCER_ALLOWED_REPO: "acme/app", ANTHROPIC_API_KEY: "injected", ANTHROPIC_AUTH_TOKEN: "injected" },
      }));
      try {
        assert.equal(run.provider, "claude-subscription");
        assert.ok(!run.args.includes("--bare"));
        assert.ok(!run.args.includes("--max-budget-usd"));
        assert.equal(value(run.args, "--max-turns"), "40");
        assert.equal(run.capMode, "turns");
        assert.equal(run.capLabel, "--max-turns=40");
        // Isolation without --bare.
        assert.equal(value(run.args, "--setting-sources"), "");
        assert.equal(value(run.args, "--tools"), "");
        assert.ok(run.args.includes("--strict-mcp-config"));
        assert.ok(run.args.includes("--disable-slash-commands"));
        assert.equal(value(run.args, "--allowed-tools"), ALLOWED_TOOLS.join(","));
        assert.equal(value(run.args, "--permission-mode"), "dontAsk");
        for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
          assert.equal(run.env[key], undefined, `${key} must be unset`);
        }
        assert.equal(run.env.OPENSRCER_ALLOWED_REPO, "acme/app");
        assert.equal(run.env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
        // An empty working directory, outside the app checkout.
        assert.deepEqual(readdirSync(run.cwd), []);
        assert.ok(!JSON.stringify(run.args).includes("user-key-for-fallback-only"));
      } finally { run.cleanup(); }
      assert.ok(!existsSync(run.cwd), "cleanup removes the run directory");
    } finally {
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.token;
    }
  });
});

test("a hosted subscription run uses the VM's own config dir", () => {
  withConfig((config) => {
    const run = buildAgentInvocation(input(config, { claudeConfigDir: "/tmp/opensrcer-claude-abc" }));
    try { assert.equal(run.env.CLAUDE_CONFIG_DIR, "/tmp/opensrcer-claude-abc"); }
    finally { run.cleanup(); }
  });
});

test("an API-key run keeps --bare, the key and the spend cap, with an empty config dir", () => {
  withConfig((config) => {
    const run = buildAgentInvocation(input(config, { provider: "anthropic-key", anthropicKey: "user-key", model: "claude-test" }));
    try {
      assert.ok(run.args.includes("--bare"));
      assert.equal(run.env.ANTHROPIC_API_KEY, "user-key");
      assert.equal(value(run.args, "--max-budget-usd"), "2");
      assert.equal(value(run.args, "--max-turns"), "40", "the turn cap is the dollar cap's twin");
      assert.equal(run.capLabel, "--max-budget-usd=2 --max-turns=40");
      assert.equal(run.capMode, "budget");
      assert.equal(value(run.args, "--model"), "claude-test");
      assert.ok(run.env.CLAUDE_CONFIG_DIR?.includes("opensrcer-run-"));
      assert.equal(run.output, "claude-stream-json");
    } finally { run.cleanup(); }
  });
});

test("the MCP config is rewritten with absolute paths so the run can use an empty cwd", () => {
  withConfig((config) => {
    const servers = resolveMcpServers(config);
    const server = servers["opensrcer-repo-tools"];
    assert.equal(server.command, process.execPath);
    assert.ok(server.args![0].endsWith("/mcp-server/dist/server.js"));
    assert.ok(!server.args![0].startsWith("."));
    const run = buildAgentInvocation(input(config, {}));
    try {
      const written = JSON.parse(readFileSync(value(run.args, "--mcp-config"), "utf8"));
      assert.deepEqual(written.mcpServers, servers);
    } finally { run.cleanup(); }
  });
});

test("a Codex run is read-only, keeps only our MCP server, and forwards credentials by name only", () => {
  withConfig((config) => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "host-openai-key";
    try {
      const run = buildAgentInvocation(input(config, { provider: "codex-subscription", anthropicKey: "user-key" }));
      try {
        assert.equal(run.args[0], "exec");
        assert.equal(run.output, "codex-jsonl");
        assert.equal(run.capMode, "timeout");
        assert.equal(value(run.args, "--sandbox"), "read-only");
        assert.equal(value(run.args, "--cd"), run.cwd);
        for (const flag of ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) assert.ok(run.args.includes(flag), flag);
        assert.ok(run.args.includes('approval_policy="never"'));
        assert.ok(run.args.includes("mcp_servers.opensrcer-repo-tools.required=true"));
        assert.ok(run.args.includes('mcp_servers.opensrcer-repo-tools.default_tools_approval_mode="approve"'), "our tools pre-approved, or approval_policy=never refuses them");
        for (const feature of ["shell_tool", "unified_exec", "view_image", "multi_agent"]) {
          assert.ok(run.args.some((arg, i) => arg === feature && run.args[i - 1] === "--disable"), feature);
        }
        assert.ok(run.args.includes('mcp_servers.opensrcer-repo-tools.env_vars=["OPENSRCER_ALLOWED_REPO","GITHUB_TOKEN"]'));
        assert.ok(!run.args.join(" ").includes("test-github-token"), "no credential on the command line");
        assert.equal(run.args.at(-1), "Fix it");
        for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY"]) assert.equal(run.env[key], undefined, key);
        assert.equal(run.env.GITHUB_TOKEN, "test-github-token");
      } finally { run.cleanup(); }
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
  });
});

test("the provider defaults to the key when one is injected, else the subscription (contrib-branch callers)", () => {
  withConfig((config) => {
    const keyed = buildAgentInvocation({ prompt: "p", mcpConfig: config, budgetUsd: 1, inject: { ANTHROPIC_API_KEY: "user-key" } });
    const plan = buildAgentInvocation({ prompt: "p", mcpConfig: config, maxTurns: 5 });
    try {
      assert.equal(keyed.provider, "anthropic-key");
      assert.ok(keyed.args.includes("--bare"));
      assert.equal(keyed.env.ANTHROPIC_API_KEY, "user-key");
      assert.equal(plan.provider, "claude-subscription");
      assert.ok(!plan.args.includes("--bare"));
    } finally { keyed.cleanup(); plan.cleanup(); }
  });
});

test("a custom tool list replaces the allowed tools for Claude and Codex", () => {
  withConfig((config) => {
    const tools = ["mcp__opensrcer-repo-tools__read_file", "mcp__opensrcer-repo-tools__write_file"];
    const claude = buildAgentInvocation(input(config, { tools }));
    const codex = buildAgentInvocation(input(config, { tools, provider: "codex-subscription" }));
    try {
      assert.equal(value(claude.args, "--allowed-tools"), tools.join(","));
      assert.ok(codex.args.includes('mcp_servers.opensrcer-repo-tools.enabled_tools=["read_file","write_file"]'));
    } finally { claude.cleanup(); codex.cleanup(); }
  });
});

test("invalid inputs fail with a named error", () => {
  withConfig((config) => {
    assert.throws(() => buildAgentInvocation(input(config, { provider: "anthropic-key" })), AgentInvocationError);
    assert.throws(() => buildAgentInvocation(input(config, { provider: "bogus" as never })), AgentInvocationError);
    assert.throws(() => buildAgentInvocation(input(config, { maxTurns: undefined })), AgentInvocationError, "a subscription run needs a turn cap");
    assert.throws(() => buildAgentInvocation(input(config, { maxTurns: 0 })), RangeError);
    assert.throws(() => buildAgentInvocation(input(config, { provider: "anthropic-key", anthropicKey: "k", budgetUsd: -1 })), RangeError);
  });
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-invocation-test-"));
  try {
    const config = join(dir, ".mcp.json");
    writeFileSync(config, "{}");
    assert.throws(() => buildAgentInvocation(input(config, { provider: "codex-subscription" })), AgentInvocationError);
    assert.throws(() => resolveMcpServers(join(dir, "missing.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Tests from the contrib-engine branch (merged). They share one real MCP
// config, since the builder resolves it, and clean up every run directory.
const CONFIG_DIR = mkdtempSync(join(tmpdir(), "opensrcer-invocation-test-"));
const CONFIG = join(CONFIG_DIR, ".mcp.json");
writeFileSync(CONFIG, JSON.stringify({ mcpServers: { "opensrcer-repo-tools": { command: "node", args: ["./mcp-server/dist/server.js"] } } }));
const made: Array<{ cleanup: () => void }> = [];
const build = (input: AgentInvocationInput) => { const run = buildAgentInvocation(input); made.push(run); return run; };
after(() => {
  for (const run of made) run.cleanup();
  rmSync(CONFIG_DIR, { recursive: true, force: true });
});
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];


test("isolation flags hold for key runs (--bare) and subscription runs (no --bare)", () => {
  const key = build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 5, budgetUsd: 2, inject: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  const plan = build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 5, budgetUsd: 2 });
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
    const plan = build({ provider: "claude-subscription", prompt: "p", mcpConfig: CONFIG, maxTurns: 60, inject: { ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "tok" } });
    assert.equal(plan.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, undefined);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved;
  }
  assert.throws(() => build({ provider: "claude-subscription", prompt: "p", mcpConfig: CONFIG }), /turn cap/);
  assert.throws(() => build({ provider: "anthropic-key", prompt: "p", mcpConfig: CONFIG, maxTurns: 1 }), /ANTHROPIC_API_KEY/);
});

test("caps and tools are validated", () => {
  const { args } = build({ prompt: "p", mcpConfig: CONFIG, tools: [...ALLOWED_TOOLS, ...EXEC_TOOLS], maxTurns: 80, inject: { ANTHROPIC_API_KEY: "k" } });
  assert.match(flag(args, "--allowed-tools"), /run_command/);
  assert.throws(() => build({ prompt: "p", mcpConfig: CONFIG, budgetUsd: 0, maxTurns: 1 }), RangeError);
  assert.throws(() => build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1.5 }), RangeError);
});

test("the stand-in agent is refused in production and hosted mode, and flagged otherwise", () => {
  const keys = ["OPENSRCER_AGENT_BIN", "OPENSRCER_AGENT_ARGS", "NODE_ENV", "VERCEL", "OPENSRCER_EXECUTION"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const env = process.env as Record<string, string | undefined>;
  const reset = () => { for (const k of keys) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; } };
  try {
    for (const k of keys) delete env[k];
    env.OPENSRCER_AGENT_BIN = "/usr/bin/node";
    env.OPENSRCER_AGENT_ARGS = "scripts/smoke-exec-agent.mjs";
    const inv = build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1 });
    assert.equal(inv.standIn, true);
    assert.equal(inv.bin, "/usr/bin/node");
    assert.equal(inv.args[0], "scripts/smoke-exec-agent.mjs");
    env.NODE_ENV = "production";
    assert.throws(() => build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1 }), StandInAgentError);
    delete env.NODE_ENV;
    env.VERCEL = "1";
    assert.throws(() => build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1 }), StandInAgentError);
    delete env.VERCEL;
    delete env.OPENSRCER_AGENT_BIN;
    assert.equal(build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1 }).standIn, false);
  } finally {
    reset();
  }
});

test("the child env is an allowlist plus explicit injections", () => {
  const saved = process.env.AUTH0_SECRET;
  process.env.AUTH0_SECRET = "must-not-leak";
  try {
    const { env } = build({ prompt: "p", mcpConfig: CONFIG, maxTurns: 1, inject: { GITHUB_TOKEN: "t", OPENSRCER_EXEC_URL: undefined } });
    assert.equal(env.AUTH0_SECRET, undefined);
    assert.equal(env.GITHUB_TOKEN, "t");
    assert.ok(!("OPENSRCER_EXEC_URL" in env));
  } finally {
    if (saved === undefined) delete process.env.AUTH0_SECRET; else process.env.AUTH0_SECRET = saved;
  }
});
