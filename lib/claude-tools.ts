// Only our repository-scoped MCP tools can execute. --allowed-tools alone
// grants permission; it does not remove built-ins under bypassPermissions.
// https://code.claude.com/docs/en/cli-reference
export const ALLOWED_TOOLS = [
  "repo_info", "list_files", "read_file", "grep", "find_definition",
  "find_references", "trace_flow", "impact_analysis", "explain_area",
].map(tool => `mcp__opensrcer-repo-tools__${tool}`);

export const READ_ONLY_CLAUDE_ARGS = [
  "--bare",
  "--setting-sources", "",
  "--tools", "",
  "--strict-mcp-config",
  "--allowed-tools", ALLOWED_TOOLS.join(","),
  "--permission-mode", "dontAsk",
];
