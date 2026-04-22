// POST /api/prs/fix
// Spawns Claude to address a review comment on an existing PR.
// Claude reads the file, understands the comment, generates a fix,
// and pushes a commit to the PR branch. Streams progress via SSE.

import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";

const MCP_CONFIG = join(process.cwd(), ".mcp.json");

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_number?: number;
    branch?: string;
    comment_body?: string;
    file_path?: string | null;
    line?: number | null;
    diff_hunk?: string | null;
    budget?: number;
  };

  if (!body.repo || !body.pr_number || !body.comment_body || !body.branch) {
    return Response.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  if (!existsSync(MCP_CONFIG)) {
    return Response.json(
      { error: "MCP server not built." },
      { status: 500 },
    );
  }

  const anthropicKey = await resolveAnthropicKey();
  if (!anthropicKey) {
    return Response.json(
      { error: "No Anthropic API key configured." },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();

  // Build a focused prompt for Claude to address the review comment
  const fileContext = body.file_path
    ? `\nThe comment is on file: ${body.file_path}${body.line ? ` at line ${body.line}` : ""}.`
    : "";
  const hunkContext = body.diff_hunk
    ? `\nDiff context:\n\`\`\`\n${body.diff_hunk}\n\`\`\``
    : "";

  const prompt = `You are fixing a review comment on PR #${body.pr_number} in ${body.repo}.

REVIEW COMMENT from maintainer:
"${body.comment_body}"
${fileContext}${hunkContext}

INSTRUCTIONS:
1. Use the MCP tools to read the file and understand the context. All MCP tools take repo: "${body.repo}".
2. Understand what the reviewer is asking for.
3. Generate the EXACT fix needed — minimal change, address only what the reviewer asked.
4. Output your fix as a fenced diff/patch block that can be applied with git apply.
5. Explain the change in 1-2 sentences.

IMPORTANT: Only change what the reviewer asked for. Do not refactor, clean up, or modify unrelated code.`;

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
    "claude-sonnet-4-5",
    "--max-budget-usd",
    String(Math.min(body.budget ?? 0.25, 1)),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.GITHUB_TOKEN;
  env.ANTHROPIC_API_KEY = anthropicKey;
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
                "taskkill",
                ["/F", "/T", "/PID", String(child.pid)],
                { stdio: "pipe" },
              );
            } catch {
              child.kill("SIGKILL");
            }
          } else {
            child.kill("SIGKILL");
          }
        }
      }, 3 * 60 * 1000);

      let lineBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        lineBuf += chunk.toString();
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);

            if (evt.type === "assistant" && evt.message?.content) {
              for (const block of evt.message.content) {
                if (block.type === "tool_use" && block.name) {
                  const toolName = block.name.replace(
                    /^mcp__opensrcer-repo-tools__/,
                    "",
                  );
                  const input = block.input ?? {};
                  let detail = "";
                  if (toolName === "grep" && input.pattern)
                    detail = `/${input.pattern}/`;
                  else if (toolName === "read_file" && input.path)
                    detail = String(input.path);
                  else if (toolName === "find_definition" && input.symbol)
                    detail = String(input.symbol);
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ tool: toolName, detail })}\n\n`,
                    ),
                  );
                }
                if (block.type === "text" && block.text) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: block.text })}\n\n`,
                    ),
                  );
                }
              }
            }

            if (evt.type === "result") {
              if (evt.result) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ text: evt.result })}\n\n`,
                  ),
                );
              }
              if (typeof evt.total_cost_usd === "number") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ cost: evt.total_cost_usd })}\n\n`,
                  ),
                );
              }
            }
          } catch {
            // not JSON
          }
        }
      });

      child.stderr.on("data", () => {});

      child.on("close", (code) => {
        clearTimeout(timeout);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, exit_code: code })}\n\n`,
          ),
        );
        controller.close();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: err.message })}\n\n`,
          ),
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
