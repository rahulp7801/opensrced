// Only our repository-scoped MCP tools can execute. --allowed-tools alone
// grants permission; it does not remove built-ins under bypassPermissions.
// https://code.claude.com/docs/en/cli-reference
export const ALLOWED_TOOLS = [
  "repo_info", "list_files", "read_file", "grep", "find_definition",
  "find_references", "trace_flow", "impact_analysis", "explain_area",
].map(tool => `mcp__opensrcer-repo-tools__${tool}`);

/** Workspace tools, served only when the dispatcher started an exec box.
 *  They act inside that credential-free box, never on the host. */
export const EXEC_TOOLS = ["write_file", "edit_file", "run_command"]
  .map(tool => `mcp__opensrcer-repo-tools__${tool}`);

/** The isolation flags, minus `--bare`. Each one stands on its own, because
 *  subscription-authenticated runs cannot use `--bare` (it ignores OAuth):
 *  no settings/hooks/plugins from the host, no built-in tools, only our MCP
 *  server, only the listed tools. */
export function isolationArgs(tools: string[] = ALLOWED_TOOLS): string[] {
  return [
    "--setting-sources", "",
    "--tools", "",
    "--strict-mcp-config",
    "--allowed-tools", tools.join(","),
    "--permission-mode", "dontAsk",
  ];
}

export const READ_ONLY_CLAUDE_ARGS = ["--bare", ...isolationArgs()];
