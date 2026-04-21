#!/usr/bin/env node
// opensrcer MCP server — stdio transport, repo-aware tools.
//
// Exposes:
//   list_files, read_file, grep, find_definition, find_references, repo_info
//
// Each tool accepts a `repo: "owner/name"` arg. The server shallow-clones
// into a cache dir on first use (see repo-cache.ts) and shells out to
// git/git-grep for the actual work.
//
// Expected caller: Claude Code, configured via .mcp.json at the workspace
// root. The server is stateless across calls — Claude drives exploration
// via the tool loop.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  findDefinition,
  findReferences,
  grepTool,
  listFiles,
  readFileTool,
  repoInfo,
} from "./tools.js";
import {
  traceFlowTool,
  impactAnalysisTool,
  explainAreaTool,
} from "./graph.js";

const server = new McpServer({
  name: "opensrcer-repo-tools",
  version: "0.1.0",
});

// Shared repo arg — "owner/name" or a GitHub URL. Every tool takes it;
// declaring it once keeps the descriptions consistent.
const repoArg = z
  .string()
  .min(3)
  .describe("GitHub repo as 'owner/name' or a full https URL.");

// Wrap tool results into MCP's { content: [{type: 'text', text}] } shape,
// with errors funneled through `isError: true` so the model sees them
// instead of the call silently failing.
function textResult(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}
function errorResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

server.tool(
  "list_files",
  "List tracked files in the repo (honors .gitignore). Optional glob filter.",
  {
    repo: repoArg,
    glob: z.string().optional().describe("Git pathspec, e.g. '*.py' or 'src/**'."),
    limit: z.number().int().min(1).max(2000).optional(),
  },
  async (args) => {
    try {
      return textResult(await listFiles(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "read_file",
  "Read a repo file with line numbers. For large files, pass line_start/line_end (1-indexed, inclusive).",
  {
    repo: repoArg,
    path: z.string().describe("Repo-relative path, e.g. 'src/lib.rs'."),
    line_start: z.number().int().min(1).optional(),
    line_end: z.number().int().min(1).optional(),
  },
  async (args) => {
    try {
      return textResult(await readFileTool(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "grep",
  "Regex-search the repo (git grep, .gitignore-aware, skips binaries). Returns file:line:match.",
  {
    repo: repoArg,
    pattern: z.string().describe("POSIX-extended regex."),
    glob: z.string().optional(),
    case_insensitive: z.boolean().optional(),
    max_matches: z.number().int().min(1).max(1000).optional(),
  },
  async (args) => {
    try {
      return textResult(await grepTool(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "find_definition",
  "Heuristic definition lookup for a symbol (catches def/class/fn/func/struct/etc. prefixes across common languages). Use grep if this misses.",
  {
    repo: repoArg,
    symbol: z.string().describe("Symbol name, e.g. 'parse_config'."),
  },
  async (args) => {
    try {
      return textResult(await findDefinition(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "find_references",
  "Every line mentioning the symbol as a whole word. Returns a per-file count summary plus raw hits.",
  {
    repo: repoArg,
    symbol: z.string(),
    max_matches: z.number().int().min(1).max(1500).optional(),
  },
  async (args) => {
    try {
      return textResult(await findReferences(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "repo_info",
  "Basic metadata + top-level file tree of the cached clone. Call this first to orient on an unfamiliar repo.",
  { repo: repoArg },
  async (args) => {
    try {
      return textResult(await repoInfo(args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

// ── Graph-powered tools (zero LLM cost) ───────────────────────────────
// These query a graphify knowledge graph built via the /graph UI page.
// They provide structural codebase understanding: call flows, blast
// radius, and module overviews. The graph must be pre-built; if missing,
// the tool returns an actionable error.

server.tool(
  "trace_flow",
  "Trace execution flow from a function/symbol through its call chain. Uses the graphify knowledge graph (must be built first via the Graph page). Zero LLM cost.",
  {
    repo: repoArg,
    symbol: z.string().describe("Function or symbol name to trace, e.g. 'handlePayment'."),
  },
  async (args) => {
    try {
      return textResult(await traceFlowTool(args.repo, args.symbol));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "impact_analysis",
  "Analyze the blast radius of changing a function/symbol — shows direct callers, indirect dependents, affected communities, and risk level. Zero LLM cost.",
  {
    repo: repoArg,
    symbol: z.string().describe("Function or symbol to analyze impact for."),
  },
  async (args) => {
    try {
      return textResult(await impactAnalysisTool(args.repo, args.symbol));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  "explain_area",
  "Explain a module/directory — shows key nodes, clusters, internal vs boundary edges, and relationship types. Zero LLM cost.",
  {
    repo: repoArg,
    directory: z.string().describe("Directory or module path to explain, e.g. 'src/api' or 'lib'."),
  },
  async (args) => {
    try {
      return textResult(await explainAreaTool(args.repo, args.directory));
    } catch (e) {
      return errorResult(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr-only logging so it doesn't corrupt the stdio JSON-RPC channel.
process.stderr.write("opensrcer-mcp-server ready\n");
