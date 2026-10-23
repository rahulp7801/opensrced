// The one place an agent CLI command line is built. Every `claude -p` spawn
// (agentic dispatch, PR deep fix, explore) goes through here, so isolation
// flags, model choice and caps cannot drift apart between call sites, and a
// different provider/runtime can be swapped in at a single seam.

import { childEnv } from "./child-env";
import { ALLOWED_TOOLS, isolationArgs } from "./claude-tools";
import { CLAUDE_AGENT_MODEL } from "./models";

export type AgentInvocationInput = {
  prompt: string;
  /** Path to the MCP config the CLI loads (and nothing else, via --strict-mcp-config). */
  mcpConfig: string;
  /** Fully qualified MCP tool names the agent may call. */
  tools?: string[];
  model?: string;
  /** Dollar cap. Meaningful only for API-key billing. */
  budgetUsd?: number;
  /** Turn cap: the cap that also holds for subscription runs, which have no
   *  per-token cost. Pair it with the caller's wall-clock timeout. */
  maxTurns?: number;
  /** Credentials and settings for this one child; undefined values are dropped. */
  inject?: Record<string, string | undefined>;
};

export type AgentInvocation = { bin: string; args: string[]; env: NodeJS.ProcessEnv };

export function buildAgentInvocation(input: AgentInvocationInput): AgentInvocation {
  const env = childEnv(input.inject);
  const args = [
    "-p", input.prompt,
    "--mcp-config", input.mcpConfig,
    // --bare skips OAuth/keychain auth, so it is only used when an API key
    // is injected. The isolation flags below hold either way.
    ...(env.ANTHROPIC_API_KEY ? ["--bare"] : []),
    ...isolationArgs(input.tools ?? ALLOWED_TOOLS),
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
    "--model", input.model ?? CLAUDE_AGENT_MODEL,
  ];
  if (input.budgetUsd !== undefined) {
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) throw new RangeError("budgetUsd must be a positive number");
    args.push("--max-budget-usd", String(input.budgetUsd));
  }
  if (input.maxTurns !== undefined) {
    if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 1) throw new RangeError("maxTurns must be a positive integer");
    args.push("--max-turns", String(input.maxTurns));
  }
  return { bin: "claude", args, env };
}
