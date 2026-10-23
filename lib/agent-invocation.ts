// The one place an agent CLI command line is built. Every `claude -p` spawn
// (agentic dispatch, PR deep fix, explore) goes through here, so isolation
// flags, model choice and caps cannot drift apart between call sites, and a
// different provider/runtime can be swapped in at a single seam.
//
// Field names mirror the subscription branch's version of this module
// (provider "claude-subscription" | "anthropic-key", capLabel) so the two
// merge additively.

import { childEnv } from "./child-env";
import { ALLOWED_TOOLS, isolationArgs } from "./claude-tools";
import { CLAUDE_AGENT_MODEL } from "./models";

export type AgentProvider = "claude-subscription" | "anthropic-key";

export type AgentInvocationInput = {
  /** Who pays. Default: the API key when one is injected, else the subscription. */
  provider?: AgentProvider;
  prompt: string;
  /** Path to the MCP config the CLI loads (and nothing else, via --strict-mcp-config). */
  mcpConfig: string;
  /** Fully qualified MCP tool names the agent may call. */
  tools?: string[];
  model?: string;
  /** Dollar cap. Applied to API-key runs only; a plan run has no per-token cost. */
  budgetUsd?: number;
  /** Turn cap: the cap that also holds for subscription runs. Required for
   *  them; pair it with the caller's wall-clock timeout. */
  maxTurns?: number;
  /** Credentials and settings for this one child; undefined values are dropped. */
  inject?: Record<string, string | undefined>;
};

export type AgentInvocation = { bin: string; args: string[]; env: NodeJS.ProcessEnv; provider: AgentProvider; capLabel: string };

// Anything that would make the CLI authenticate with something other than
// the credential this run is meant to use.
const CLAUDE_CREDENTIAL_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
];

export function buildAgentInvocation(input: AgentInvocationInput): AgentInvocation {
  const key = input.inject?.ANTHROPIC_API_KEY;
  const provider: AgentProvider = input.provider ?? (key ? "anthropic-key" : "claude-subscription");
  if (provider === "anthropic-key" && !key) throw new RangeError("an API-key run needs ANTHROPIC_API_KEY");
  if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) throw new RangeError("budgetUsd must be a positive number");
  if (input.maxTurns !== undefined && (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1)) throw new RangeError("maxTurns must be a positive integer");
  const subscription = provider === "claude-subscription";
  if (subscription && input.maxTurns === undefined) throw new RangeError("a subscription run needs a turn cap (maxTurns)");

  const env = childEnv({
    // Wait for our MCP server before the first turn. The CLI otherwise
    // connects in the background (status "pending", 0 tools) and the model's
    // first turn runs toolless: in two real runs it wrote imaginary
    // "Tool Call:" blocks and ended. Startup (tree-sitter wasm, cold disk)
    // also needs more than the default connect timeout.
    // Measured here: 36 s cold, 2.6 s warm.
    MCP_CONNECTION_NONBLOCKING: "0",
    MCP_TIMEOUT: "120000",
    MCP_CONNECT_TIMEOUT_MS: "120000",
    ...input.inject,
  });
  // A plan run uses the CLI's own login: no credential may override it.
  if (subscription) for (const k of CLAUDE_CREDENTIAL_VARS) delete env[k];
  const caps: string[] = [
    ...(!subscription && input.budgetUsd !== undefined ? ["--max-budget-usd", String(input.budgetUsd)] : []),
    ...(input.maxTurns !== undefined ? ["--max-turns", String(input.maxTurns)] : []),
  ];
  const args = [
    "-p", input.prompt,
    "--mcp-config", input.mcpConfig,
    // --bare skips OAuth/keychain auth, so only API-key runs use it. The
    // isolation flags below hold either way.
    ...(subscription ? ["--disable-slash-commands"] : ["--bare"]),
    ...isolationArgs(input.tools ?? ALLOWED_TOOLS),
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
    "--model", input.model ?? CLAUDE_AGENT_MODEL,
    ...caps,
  ];
  // OPENSRCER_AGENT_BIN/_ARGS: operator-only override for end-to-end checks
  // with a scripted stand-in (scripts/smoke-exec-agent.mjs). Unset in normal use.
  const bin = process.env.OPENSRCER_AGENT_BIN || "claude";
  const pre = process.env.OPENSRCER_AGENT_BIN ? (process.env.OPENSRCER_AGENT_ARGS ?? "").split(/\s+/).filter(Boolean) : [];
  const capLabel = caps.length ? caps.join(" ").replace(/(--\S+) (\S+)/g, "$1=$2") : "wall-clock timeout only";
  return { bin, args: [...pre, ...args], env, provider, capLabel };
}
