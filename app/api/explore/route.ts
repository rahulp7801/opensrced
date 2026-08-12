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
import { auth0 } from "@/lib/auth0";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { resolveGithubToken } from "@/lib/crucible/tokens";
import { acquireSlot, releaseSlot, activeSlots } from "@/lib/concurrency";
import { CLAUDE_AGENT_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

const MAX_CONCURRENT_EXPLORE = 3;

const MCP_CONFIG = join(process.cwd(), ".mcp.json");

function buildExplorePrompt(repoFull: string, query: string): string {
  return `You are a codebase navigator for \`${repoFull}\`. All MCP tools take repo: "${repoFull}".

Question: ${query}

Use grep/find_definition/read_file to locate the answer. Answer directly in 2-4 sentences, then show relevant file:line references with key code snippets (5-30 lines each, fenced). Be concise.`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo_url?: string;
    query?: string;
    budget?: number;
    github_org?: string;
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

  // Parse owner/name from URL and sanitize
  const m = /github\.com[:/]+([^/]+)\/([^/?#\s.]+)|^([^/\s]+)\/([^/\s]+)$/.exec(
    body.repo_url.trim().replace(/\.git$/i, ""),
  );
  const rawOwner = m?.[1] ?? m?.[3];
  const rawName = m?.[2] ?? m?.[4];
  if (!rawOwner || !rawName) {
    return new Response(
      JSON.stringify({ error: "Invalid repo URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const { sanitizeRepoId: sanitizeRepo } = await import("@/lib/sanitize");
  const repoFull = sanitizeRepo(`${rawOwner}/${rawName}`);
  if (!repoFull) {
    return new Response(
      JSON.stringify({ error: "Invalid repo identifier" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const [owner, name] = repoFull.split("/");

  // Concurrency limit. Acquired LAST, after every cheap rejection above —
  // the slot is only released once the stream closes, so any early return
  // between acquire and stream-start leaks it for the process lifetime.
  // Four returns above used to sit inside that window.
  if (!acquireSlot("explore", MAX_CONCURRENT_EXPLORE)) {
    return new Response(
      JSON.stringify({ error: `Too many concurrent explorations (${activeSlots("explore")}/${MAX_CONCURRENT_EXPLORE}). Wait for one to finish.` }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

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
    "--model",
    CLAUDE_AGENT_MODEL,
    "--max-budget-usd",
    String(Math.min(Math.max(body.budget ?? 0.15, 0.01), 2)),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.GITHUB_TOKEN;
  env.ANTHROPIC_API_KEY = anthropicKey;

  // Private repo support — use installation token if org is specified
  if (body.github_org) {
    const session = await auth0.getSession();
    const sub = session?.user?.sub;
    if (sub) {
      const mapping = mappingForOrg(sub, body.github_org);
      if (mapping) {
        const resolved = await resolveGithubToken({ auth0UserId: sub, githubOrg: body.github_org });
        if (resolved.token) env.GITHUB_TOKEN = resolved.token;
      }
    }
  }
  // Public repos — use the user's GitHub OAuth token from Auth0
  if (!env.GITHUB_TOKEN) {
    const token = await resolveGitHubToken();
    if (token) env.GITHUB_TOKEN = token;
  }

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

            // Final result — cost only, text already streamed above
            if (evt.type === "result") {
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
        releaseSlot("explore");
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, exit_code: code })}\n\n`),
        );
        controller.close();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        releaseSlot("explore");
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
