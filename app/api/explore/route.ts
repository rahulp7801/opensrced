// POST /api/explore
// Spawns `claude -p` with the MCP repo tools and a focused exploration
// prompt. Streams the response back as SSE so the UI renders progressively.
// Budget is capped low ($0.15) since this is read-only exploration.

import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";

const MCP_CONFIG = join(process.cwd(), ".mcp.json");

function buildExplorePrompt(repoFull: string, query: string): string {
  return [
    `You are a codebase navigator. The user is asking about the repository \`${repoFull}\`.`,
    ``,
    `## User's question`,
    ``,
    query,
    ``,
    `## Your tools`,
    ``,
    `The MCP server \`opensrcer-repo-tools\` is configured. Every tool takes \`repo: "${repoFull}"\`.`,
    ``,
    `- \`repo_info\` — get an overview of the repo structure.`,
    `- \`list_files\` — directory/glob listing.`,
    `- \`read_file\` — read a specific file (pass \`line_start\`/\`line_end\` for large files).`,
    `- \`grep\` — regex search across the codebase.`,
    `- \`find_definition\` — find where a symbol is defined (uses tree-sitter AST index).`,
    `- \`find_references\` — find every usage of a symbol.`,
    ``,
    `## How to respond`,
    ``,
    `1. Use the tools to find the answer. Start broad (repo_info, list_files) then drill into specific files.`,
    `2. Structure your response clearly:`,
    `   - **Answer the question directly** in 2-4 sentences at the top.`,
    `   - **Show the relevant files** with their paths.`,
    `   - **Include key code snippets** — copy the actual lines from read_file output. Use fenced code blocks with the language and file path as a comment on the first line.`,
    `   - If the answer spans multiple files, show each one with context.`,
    `3. Be precise about line numbers — always cite \`file:line\` so the user can jump directly there.`,
    `4. Keep it concise. Don't dump entire files — show the 5-30 most relevant lines per file.`,
    `5. If you can't find what the user is asking about, say so clearly and suggest what to search for instead.`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo_url?: string;
    query?: string;
    budget?: number;
  };

  if (!body.repo_url || !body.query) {
    return new Response(
      JSON.stringify({ error: "Missing repo_url or query" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!existsSync(MCP_CONFIG)) {
    return new Response(
      JSON.stringify({ error: "MCP server not built. Run: cd mcp-server && npm run build" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const anthropicKey = await resolveAnthropicKey();
  if (!anthropicKey) {
    return new Response(
      JSON.stringify({ error: "No Anthropic API key configured." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Parse owner/name from URL
  const m = /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
    body.repo_url.trim().replace(/\.git$/i, ""),
  );
  const owner = m?.[1] ?? m?.[3];
  const name = m?.[2] ?? m?.[4];
  if (!owner || !name) {
    return new Response(
      JSON.stringify({ error: "Invalid repo URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const repoFull = `${owner}/${name}`;

  const prompt = buildExplorePrompt(repoFull, body.query);

  const args = [
    "-p",
    prompt,
    "--mcp-config",
    MCP_CONFIG,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(Math.min(Math.max(body.budget ?? 0.15, 0.01), 2)),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ANTHROPIC_API_KEY = anthropicKey;
  const token = await resolveGitHubToken();
  if (token) env.GITHUB_TOKEN = token;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const child = spawn("claude", args, { env, windowsHide: true });

      const timeout = setTimeout(() => {
        if (!child.killed && child.pid) {
          if (process.platform === "win32") {
            try {
              require("node:child_process").execFileSync(
                "taskkill", ["/F", "/T", "/PID", String(child.pid)],
                { stdio: "pipe" },
              );
            } catch {
              child.kill("SIGKILL");
            }
          } else {
            child.kill("SIGKILL");
          }
        }
      }, 3 * 60 * 1000); // 3 min max

      let lineBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        lineBuf += chunk.toString();
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);

            // Tool use events — Claude calling MCP tools
            // Structure: { type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }
            if (evt.type === "assistant" && evt.message?.content) {
              for (const block of evt.message.content) {
                if (block.type === "tool_use" && block.name) {
                  const toolName = block.name.replace(/^mcp__opensrcer-repo-tools__/, "");
                  const input = block.input ?? {};
                  let detail = "";
                  if (toolName === "grep" && input.pattern) detail = `/${input.pattern}/`;
                  else if (toolName === "read_file" && input.path) detail = String(input.path);
                  else if (toolName === "find_definition" && input.symbol) detail = String(input.symbol);
                  else if (toolName === "find_references" && input.symbol) detail = String(input.symbol);
                  else if (toolName === "list_files" && input.glob) detail = String(input.glob);
                  else if (toolName === "list_files") detail = "root";
                  else if (toolName === "repo_info") detail = "overview";

                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ tool: toolName, detail })}\n\n`,
                  ));
                }

                // Text blocks in assistant messages
                if (block.type === "text" && block.text) {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ text: block.text })}\n\n`,
                  ));
                }
              }
            }

            // Final result — includes cost
            if (evt.type === "result") {
              if (evt.result) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ text: evt.result })}\n\n`,
                ));
              }
              if (typeof evt.total_cost_usd === "number") {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ cost: evt.total_cost_usd })}\n\n`,
                ));
              }
            }
          } catch {
            // Not JSON — skip
          }
        }
      });

      child.stderr.on("data", () => {
        // Swallow stderr
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exit_code: code })}\n\n`),
        );
        controller.close();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`),
        );
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
