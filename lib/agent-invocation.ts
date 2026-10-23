// One place that decides how an agent CLI is launched for a run: which
// binary, which flags, which environment, and how the run is capped.
//
// Three ways to pay for a run, in the order users are steered toward:
//   claude-subscription  the user's own Claude plan, via the unmodified Claude
//                        Code CLI and the login it already holds
//   codex-subscription   the user's own ChatGPT plan, via their own installed
//                        and logged-in Codex CLI (local/self-hosted only)
//   anthropic-key        the user's Anthropic API key (the original flow)
//
// Compliance notes (PLAN.md has the clause-by-clause mapping):
//   - We never read, copy or pass a Claude login. A subscription run simply
//     runs the CLI with no API key in its environment, so the CLI uses the
//     login it already has (or the one the user just made in a hosted VM).
//   - --bare ignores the subscription login, so subscription runs drop it and
//     get the same isolation another way: no setting sources (no hooks,
//     plugins or CLAUDE.md), strict MCP config, no built-in tools, only our
//     read-only MCP tools allowed, and an empty working directory.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { childEnv } from "./child-env";
import { ALLOWED_TOOLS, READ_ONLY_CLAUDE_ARGS } from "./claude-tools";

export const AGENT_PROVIDERS = ["claude-subscription", "codex-subscription", "anthropic-key"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** Plain-text labels for logs and the UI. No product names in feature names. */
export const PROVIDER_LABELS: Record<AgentProvider, string> = {
  "claude-subscription": "Claude subscription",
  "codex-subscription": "ChatGPT subscription",
  "anthropic-key": "Anthropic API key",
};

// Field names match the contrib-engine branch's version of this module
// (prompt, mcpConfig, tools, model, budgetUsd, maxTurns, inject), so the two
// merge additively; provider, anthropicKey and claudeConfigDir are this
// branch's additions.
export type AgentInvocationInput = {
  /** Who pays. Default: the API key when one is supplied, else the Claude subscription. */
  provider?: AgentProvider;
  prompt: string;
  /** Path of the MCP config (.mcp.json). Relative server paths resolve against its directory. */
  mcpConfig: string;
  /** Fully qualified MCP tool names the agent may call. */
  tools?: string[];
  model?: string;
  /** Dollar cap. Applied to API-key runs only; a plan run has no per-token cost. */
  budgetUsd?: number;
  /** Turn cap. Required for subscription runs; applied to every Claude run. */
  maxTurns?: number;
  /** Scope and credentials for this one child (OPENSRCER_ALLOWED_REPO, GITHUB_TOKEN, ...).
   *  Any Anthropic/OpenAI credential in here is removed for subscription runs. */
  inject?: Record<string, string | undefined>;
  /** The user's API key for an anthropic-key run (or inject.ANTHROPIC_API_KEY). */
  anthropicKey?: string;
  /** Claude config directory holding this run's login (hosted VM sign-in).
   *  Local subscription runs leave it unset so the CLI uses its own login. */
  claudeConfigDir?: string;
};

export type AgentInvocation = {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  provider: AgentProvider;
  /** Empty per-run directory, so no project CLAUDE.md/AGENTS.md/.mcp.json is found. */
  cwd: string;
  capMode: "budget" | "turns" | "timeout";
  /** One line for the run log header, e.g. "--max-turns=40". */
  capLabel: string;
  /** Which stream parser reads stdout. */
  output: "claude-stream-json" | "codex-jsonl";
  /** Remove the per-run directory. Safe to call more than once. */
  cleanup: () => void;
};

/** The provider needs something the caller did not supply. */
export class AgentInvocationError extends Error {}

// Variables that would make the Claude CLI authenticate with something other
// than the credential this run is meant to use. Precedence puts every one of
// these above the subscription login (code.claude.com/docs/en/authentication).
const CLAUDE_CREDENTIAL_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
];
// Codex reads these before its saved ChatGPT login.
const CODEX_CREDENTIAL_VARS = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL"];

// Codex features that add tools beyond our MCP server. Turning them off keeps
// the Codex run to the same read-only toolbelt as the Claude path; the CI
// probe (scripts/smoke-worker-tools.mjs) checks the resulting tool list.
// ponytail: names track Codex's feature flags; the probe fails when a new one adds a tool.
export const CODEX_DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "browser_use", "browser_use_external",
  "computer_use", "image_generation", "view_image", "hooks", "in_app_browser", "skill_search", "tool_suggest",
  "goals", "sleep_tool", "memories",
];

const MCP_SERVER = "opensrcer-repo-tools";

type McpServer = { command: string; args?: string[]; env?: Record<string, string> };

/** Read the MCP config and make relative paths absolute, so the run can use
 *  an empty working directory. */
export function resolveMcpServers(configPath: string): Record<string, McpServer> {
  const base = dirname(resolve(configPath));
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers?: Record<string, McpServer> };
  const servers: Record<string, McpServer> = {};
  for (const [name, server] of Object.entries(parsed.mcpServers ?? {})) {
    servers[name] = {
      ...server,
      // The running Node, not whatever "node" a child's PATH resolves to.
      command: server.command === "node" ? process.execPath : server.command,
      args: (server.args ?? []).map((arg) => (/^\.\.?[\\/]/.test(arg) ? resolve(base, arg).replaceAll("\\", "/") : arg)),
    };
  }
  return servers;
}

/** TOML value for a Codex `-c key=value` override. JSON strings and arrays of
 *  strings are valid TOML. */
function toml(value: string | string[]): string {
  return JSON.stringify(value);
}

export function buildAgentInvocation(input: AgentInvocationInput): AgentInvocation {
  // Validate everything before creating the run directory.
  const anthropicKey = input.anthropicKey ?? input.inject?.ANTHROPIC_API_KEY;
  const provider: AgentProvider = input.provider ?? (anthropicKey ? "anthropic-key" : "claude-subscription");
  if (!AGENT_PROVIDERS.includes(provider)) throw new AgentInvocationError(`Unknown provider: ${String(provider)}`);
  if (provider === "anthropic-key" && !anthropicKey) throw new AgentInvocationError("An Anthropic API key is required for an API-key run.");
  if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) throw new RangeError("budgetUsd must be a positive number");
  if (input.maxTurns !== undefined && (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1)) throw new RangeError("maxTurns must be a positive integer");
  if (provider === "claude-subscription" && input.maxTurns === undefined) throw new AgentInvocationError("A subscription run needs a turn cap (maxTurns).");
  const tools = input.tools ?? ALLOWED_TOOLS;
  const servers = resolveMcpServers(input.mcpConfig);

  const runDir = mkdtempSync(join(tmpdir(), "opensrcer-run-"));
  const cwd = join(runDir, "work");
  mkdirSync(cwd);
  const cleanup = () => { try { rmSync(runDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

  try {
    if (provider === "codex-subscription") return codexInvocation(input, tools, servers, cwd, cleanup);

    const mcpPath = join(runDir, "mcp.json");
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
    const subscription = provider === "claude-subscription";
    const env = childEnv({
      ...input.inject,
      ANTHROPIC_API_KEY: subscription ? undefined : anthropicKey,
      // A subscription run uses the login in this directory: the hosted VM's
      // fresh sign-in, or (local) the operator's own CLAUDE_CONFIG_DIR, or the
      // CLI default when neither is set. API-key runs get an empty one.
      CLAUDE_CONFIG_DIR: subscription ? input.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR : join(runDir, "claude-config"),
      // claude.ai connectors load for subscription logins unless turned off.
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      DISABLE_AUTOUPDATER: "1",
      // In -p mode the CLI connects MCP servers without waiting by default, and
      // our server's cold start (~36 s on a slow disk) outlasts the default
      // timeout: the model then starts with no repo tools. Wait for it.
      MCP_CONNECTION_NONBLOCKING: "0",
      MCP_TIMEOUT: "120000",
      MCP_CONNECT_TIMEOUT_MS: "120000",
    });
    for (const key of CLAUDE_CREDENTIAL_VARS) if (!(key === "ANTHROPIC_API_KEY" && !subscription)) delete env[key];

    // READ_ONLY_CLAUDE_ARGS with this run's tool list; --bare only with a key.
    const isolation = READ_ONLY_CLAUDE_ARGS
      .filter((arg) => !(subscription && arg === "--bare"))
      .map((arg, i, all) => (all[i - 1] === "--allowed-tools" ? tools.join(",") : arg));
    // A plan run has no per-token cost, so only turns (and the caller's wall
    // clock) cap it; a key run keeps its dollar cap and gets the turn twin.
    const caps: Array<[string, string]> = [
      ...(!subscription && input.budgetUsd !== undefined ? [["--max-budget-usd", String(input.budgetUsd)] as [string, string]] : []),
      ...(input.maxTurns !== undefined ? [["--max-turns", String(input.maxTurns)] as [string, string]] : []),
    ];
    const args = [
      "-p", input.prompt,
      "--mcp-config", mcpPath,
      ...isolation,
      // Without --bare, skills would still resolve; nothing here needs them.
      ...(subscription ? ["--disable-slash-commands"] : []),
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--verbose",
      ...(input.model ? ["--model", input.model] : []),
      ...caps.flat(),
    ];
    return {
      provider, bin: process.env.CLAUDE_BIN || "claude", args, env, cwd,
      capMode: subscription ? "turns" : "budget",
      capLabel: caps.map(([flag, value]) => `${flag}=${value}`).join(" ") || "wall-clock timeout only",
      output: "claude-stream-json", cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function codexInvocation(
  input: AgentInvocationInput,
  tools: string[],
  servers: Record<string, McpServer>,
  cwd: string,
  cleanup: () => void,
): AgentInvocation {
  const server = servers[MCP_SERVER];
  if (!server) throw new AgentInvocationError(`The MCP config has no ${MCP_SERVER} server.`);
  const inject = input.inject ?? {};
  const env = childEnv({ ...inject, CODEX_HOME: process.env.CODEX_HOME });
  for (const key of CODEX_CREDENTIAL_VARS) delete env[key];
  for (const key of CLAUDE_CREDENTIAL_VARS) delete env[key];
  // The MCP server gets scope and the GitHub token by name from our env, so
  // no credential ever appears on a command line.
  const forwarded = Object.keys(inject).filter((key) => env[key]);
  const prefix = `mcp_servers.${MCP_SERVER}`;
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    // No user config.toml (its MCP servers, profiles, providers) and no
    // execpolicy rules. Auth still comes from CODEX_HOME, i.e. the user's login.
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox", "read-only",
    "--cd", cwd,
    "-c", `approval_policy=${toml("never")}`,
    "-c", "project_doc_max_bytes=0",
    "-c", `web_search=${toml("disabled")}`,
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "-c", `${prefix}.command=${toml(server.command)}`,
    "-c", `${prefix}.args=${toml(server.args ?? [])}`,
    "-c", `${prefix}.env_vars=${toml(forwarded)}`,
    "-c", `${prefix}.enabled_tools=${toml(tools.filter((tool) => tool.startsWith(`mcp__${MCP_SERVER}__`)).map((tool) => tool.split("__").at(-1)!))}`,
    // Codex starts optional MCP servers in the background and does not wait
    // for them, so a slow cold start would leave the run with no repo tools.
    "-c", `${prefix}.required=true`,
    "-c", `${prefix}.startup_timeout_sec=120`,
    ...(input.model ? ["--model", input.model] : []),
    input.prompt,
  ];
  return {
    provider: "codex-subscription", bin: process.env.OPENSRCER_CODEX_BIN || "codex", args, env, cwd,
    // Codex has no turn or spend flag; the caller's wall-clock timeout is the cap.
    capMode: "timeout", capLabel: "wall-clock timeout only", output: "codex-jsonl", cleanup,
  };
}
