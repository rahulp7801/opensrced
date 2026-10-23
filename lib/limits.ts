// Every run-scale knob in one place. Read at call time (not import time) so
// tests and long-lived servers see the current environment.
//
// A malformed value falls back to the default rather than to 0 or NaN: a
// typo in a knob must not turn a cap off.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

/** Repository clone limits. `env` is forwarded to the MCP server and
 *  mcp-server/dist/prepare.js, which own the clone cache. */
export function cloneLimits() {
  const timeoutMs = num("OPENSRCER_CLONE_TIMEOUT_MS", 10 * 60_000);
  return {
    timeoutMs,
    env: {
      OPENSRCER_CLONE_TIMEOUT_MS: String(timeoutMs),
      OPENSRCER_INDEX_TIMEOUT_MS: String(num("OPENSRCER_INDEX_TIMEOUT_MS", 120_000)),
    } as Record<string, string>,
  };
}

/** How long the agent CLI waits for the repository tools' MCP server to
 *  connect. Its cold start was ~36-62 s on a slow local disk and timed out at
 *  120 s under load; a run that still starts without tools fails (zero-tool guard). */
export function mcpConnectTimeoutMs(): number {
  return num("OPENSRCER_MCP_CONNECT_TIMEOUT_MS", 5 * 60_000);
}

/** Agent run caps. Dollars bind on API-key runs; turns and wall clock bind
 *  on every run, including subscription-authenticated ones. */
export function agentLimits(kind: "fast" | "full" | "exec") {
  const budget = { fast: num("OPENSRCER_AGENTIC_LEAF_BUDGET_USD", 0.5), full: num("OPENSRCER_AGENTIC_BUDGET_USD", 2), exec: num("OPENSRCER_AGENTIC_EXEC_BUDGET_USD", 4) }[kind];
  const maxTurns = { fast: num("OPENSRCER_AGENTIC_LEAF_MAX_TURNS", 15), full: num("OPENSRCER_AGENTIC_MAX_TURNS", 60), exec: num("OPENSRCER_AGENTIC_EXEC_MAX_TURNS", 120) }[kind];
  return {
    budgetUsd: budget,
    maxTurns: Math.trunc(maxTurns),
    timeoutMs: num("OPENSRCER_AGENTIC_TIMEOUT_MS", (kind === "exec" ? 75 : 30) * 60_000),
  };
}

/** Repository graph build (graphify) wall clock. */
export function graphLimits() {
  return { timeoutMs: num("OPENSRCER_GRAPH_TIMEOUT_MS", 240_000) };
}

/** Exec box limits (lib/exec-box.ts, scripts/exec-server.cjs). */
export function execLimits() {
  return {
    image: str("OPENSRCER_EXEC_IMAGE", "opensrcer-exec:2"),
    /** One command's wall clock. pip/yarn installs of big repos need minutes. */
    cmdTimeoutMs: num("OPENSRCER_EXEC_CMD_TIMEOUT_MS", 15 * 60_000),
    /** Sum of all command time in one box. */
    // Sized for vllm/pytorch: CPU torch + deps install alone can take 10-20 min.
    totalMs: num("OPENSRCER_EXEC_TOTAL_MS", 60 * 60_000),
    /** Output returned per command (head + tail are kept). */
    outputBytes: num("OPENSRCER_EXEC_OUTPUT_BYTES", 48 * 1024),
    /** Host-run environment setup (installs) before the agent starts; its
     *  own clock, so installs never eat the agent's wall clock or turns. */
    setupMs: num("OPENSRCER_EXEC_SETUP_MS", 25 * 60_000),
    /** The box kills itself after this, whatever the host does. */
    maxLifetimeMs: num("OPENSRCER_EXEC_MAX_LIFETIME_MS", 120 * 60_000),
    memory: str("OPENSRCER_EXEC_MEMORY", "6g"),
    cpus: str("OPENSRCER_EXEC_CPUS", "4"),
  };
}
