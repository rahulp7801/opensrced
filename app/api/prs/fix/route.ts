// POST /api/prs/fix
// Two-tier fix generation:
//   1. Quick fix (default): Haiku + file content fetched via gh API. ~$0.001.
//      Used when file_path is known (single inline comment).
//   2. Deep fix: Sonnet + MCP tools for code exploration. ~$0.05-0.15.
//      Used for multi-file fixes, "fix all", or when user opts in.

import { NextRequest } from "next/server";
import { spawn, execFile } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeForPrompt, sanitizeRepoId, sanitizeFilePath, sanitizeBranchName, sanitizePrNumber } from "@/lib/sanitize";
import { acquireSlot, releaseSlot, activeSlots } from "@/lib/concurrency";
import { requireSession } from "@/lib/require-session";
import { CLAUDE_AGENT_MODEL, CLAUDE_FAST_MODEL } from "@/lib/models";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const MAX_CONCURRENT_FIXES = 3;

const MCP_CONFIG = join(process.cwd(), ".mcp.json");

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const raw = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_number?: number;
    branch?: string;
    comment_body?: string;
    file_path?: string | null;
    line?: number | null;
    diff_hunk?: string | null;
    budget?: number;
    mode?: "quick" | "deep";
  };

  const body = {
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
    pr_number: raw.pr_number ? sanitizePrNumber(raw.pr_number) : null,
    branch: raw.branch ? sanitizeBranchName(raw.branch) : null,
    comment_body: raw.comment_body ? sanitizeForPrompt(raw.comment_body) : null,
    file_path: raw.file_path ? sanitizeFilePath(raw.file_path) : null,
    line: raw.line ?? null,
    diff_hunk: raw.diff_hunk ? sanitizeForPrompt(raw.diff_hunk) : null,
    budget: raw.budget,
    mode: raw.mode ?? "quick",
  };

  if (!body.repo || !body.pr_number || !body.comment_body || !body.branch) {
    return Response.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const anthropicKey = await resolveAnthropicKey();
  if (!anthropicKey) {
    return Response.json(
      { error: "No Anthropic API key configured." },
      { status: 400 },
    );
  }

  // Concurrency limit. Acquired LAST, after every cheap rejection above —
  // from here the slot is only released inside the streaming handlers, so
  // an early return in between would leak it for the process lifetime.
  if (!acquireSlot("fix", MAX_CONCURRENT_FIXES)) {
    return Response.json(
      { error: `Too many concurrent fix generations (${activeSlots("fix")}/${MAX_CONCURRENT_FIXES}). Wait for one to finish.` },
      { status: 429 },
    );
  }

  const token = await resolveGitHubToken();

  // ── Route to quick or deep fix ──────────────────────────────────
  // Quick: single file known, use Haiku with file content (~$0.001)
  // Deep: no file path, multi-file, or user requested deep mode (~$0.05+)
  const useQuickFix = body.mode === "quick" && body.file_path;

  if (useQuickFix) {
    return quickFix(body, anthropicKey, token);
  } else {
    return deepFix(body, anthropicKey, token);
  }
}

// ── Quick fix: Haiku + file content fetched via gh ────────────────

async function quickFix(
  body: {
    repo: string | null;
    pr_number: number | null;
    branch: string | null;
    comment_body: string | null;
    file_path: string | null;
    line: number | null;
    diff_hunk: string | null;
  },
  apiKey: string,
  ghToken: string | null,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (ghToken) env.GH_TOKEN = ghToken;

        // 1. Read file from repo cache (same cache the MCP server uses)
        //    Falls back to GitHub API if cache miss.
        send({ tool: "read_file", detail: body.file_path });

        let fileContent = "";
        const cacheDir = join(
          process.env.OPENSRCER_CACHE_DIR || join(require("node:os").homedir(), ".contribai", "repos"),
          `${body.repo!.replace("/", "__")}`,
        );
        const cachedFile = join(cacheDir, body.file_path!);

        try {
          // Try repo cache first (instant, no network)
          const { readFile: rf } = await import("node:fs/promises");
          const { existsSync } = await import("node:fs");
          if (existsSync(cachedFile)) {
            fileContent = await rf(cachedFile, "utf8");
          } else {
            throw new Error("not cached");
          }
        } catch {
          // Cache miss — fetch via gh API at the PR branch ref
          try {
            const ref = body.branch ? `&ref=${encodeURIComponent(body.branch)}` : "";
            const { stdout } = await execFileAsync(
              "gh",
              ["api", `repos/${body.repo}/contents/${body.file_path}?ref=${body.branch ?? ""}`, "--header", "Accept: application/vnd.github.v3.raw"],
              { env, maxBuffer: 5 * 1024 * 1024, windowsHide: true, timeout: 15000 },
            );
            fileContent = stdout;
          } catch {
            send({ text: "Could not fetch file content. Try deep fix mode instead.\n\n" });
            send({ done: true });
            releaseSlot("fix");
            controller.close();
            return;
          }
        }

        // 2. Smart context: if file is large, extract relevant section
        //    + grep for related symbols (same approach as MCP tools)
        let trimmedContent = fileContent;
        const fileLines = fileContent.split("\n");

        if (fileLines.length > 200 && body.line) {
          // Keep ~100 lines around the target, with line numbers
          const start = Math.max(0, body.line - 50);
          const end = Math.min(fileLines.length, body.line + 50);
          trimmedContent = fileLines
            .slice(start, end)
            .map((l, i) => `${start + i + 1} | ${l}`)
            .join("\n");
          trimmedContent = `[lines ${start + 1}-${end} of ${fileLines.length}]\n${trimmedContent}`;
        } else {
          // Small file — include with line numbers
          trimmedContent = fileLines.map((l, i) => `${i + 1} | ${l}`).join("\n");
        }

        // 3. If diff hunk mentions other symbols, try to grep for them in cache
        let extraContext = "";
        if (body.comment_body && cacheDir) {
          // Extract likely symbol names from the comment
          const symbolMatch = body.comment_body.match(/`([a-zA-Z_]\w+)`/g);
          if (symbolMatch && symbolMatch.length > 0) {
            const symbols = symbolMatch.map((s) => s.replace(/`/g, "")).slice(0, 3);
            for (const sym of symbols) {
              try {
                const { stdout } = await execFileAsync(
                  "git", ["-C", cacheDir, "grep", "-n", "--max-count=5", sym, "--", "*.py", "*.ts", "*.js", "*.rs", "*.go", "*.java"],
                  { env, maxBuffer: 1024 * 1024, windowsHide: true, timeout: 5000 },
                );
                if (stdout.trim()) {
                  extraContext += `\nReferences to \`${sym}\`:\n${stdout.trim().slice(0, 1000)}\n`;
                }
              } catch { /* no matches or git not available */ }
            }
          }
        }

        const lineContext = body.line ? `The comment is on line ${body.line}.` : "";
        const hunkContext = body.diff_hunk
          ? `\nDiff context around the comment:\n\`\`\`\n${body.diff_hunk}\n\`\`\``
          : "";

        const systemPrompt = `You are fixing a review comment on a pull request. Generate the SMALLEST possible fix.

File: ${body.file_path}
${lineContext}

Current file content:
\`\`\`
${trimmedContent}
\`\`\`
${hunkContext}
${extraContext ? `\nRelated code found in the repo:\n${extraContext}` : ""}

Rules:
- Output ONLY a fenced \`\`\`diff block with proper --- a/ and +++ b/ headers
- Then explain in 1-2 sentences what you changed
- ONLY change what the reviewer asked for
- Do NOT add extra comments, docstrings, or refactoring
- Keep the fix minimal — ideally under 10 lines changed`;

        const userMsg = `Review comment from maintainer:\n"${body.comment_body}"\n\nGenerate the fix:`;

        // 3. Stream from Haiku
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: CLAUDE_FAST_MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            stream: true,
            messages: [{ role: "user", content: userMsg }],
          }),
        });

        if (!res.ok) {
          send({ error: `API error: ${res.status}` });
          send({ done: true });
          releaseSlot("fix");
          controller.close();
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) { send({ done: true }); releaseSlot("fix"); controller.close(); return; }

        const decoder = new TextDecoder();
        let buf = "";
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data) as {
                type?: string;
                delta?: { text?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
              };
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                send({ text: evt.delta.text });
              }
              if (evt.type === "message_start" && evt.message?.usage) {
                inputTokens = evt.message.usage.input_tokens ?? 0;
              }
              if (evt.type === "message_delta" && evt.usage) {
                outputTokens = evt.usage.output_tokens ?? 0;
              }
            } catch { /* skip */ }
          }
        }

        // Estimate cost: Haiku input=$0.80/MTok, output=$4/MTok
        const cost = (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
        send({ cost });
        send({ done: true });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
        send({ done: true });
      } finally {
        releaseSlot("fix");
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ── Deep fix: Sonnet + MCP tools ──────────────────────────────────

function deepFix(
  body: {
    repo: string | null;
    pr_number: number | null;
    branch: string | null;
    comment_body: string | null;
    file_path: string | null;
    line: number | null;
    diff_hunk: string | null;
    budget?: number;
  },
  apiKey: string,
  ghToken: string | null,
) {
  if (!existsSync(MCP_CONFIG)) {
    releaseSlot("fix");
    return Response.json(
      { error: "MCP server not built." },
      { status: 500 },
    );
  }

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
3. Generate the SMALLEST possible fix — ideally under 10 lines changed.
4. Output your fix as a fenced \`\`\`diff block with proper --- a/ and +++ b/ headers.
5. Explain in 1-2 sentences what you changed and why.

CONSTRAINTS — these are hard rules, not suggestions:
- ONLY change what the reviewer explicitly asked for
- Do NOT add comments, docstrings, or type annotations the reviewer didn't ask for
- Do NOT refactor surrounding code, rename variables, or "improve" anything
- Do NOT add error handling, validation, or imports unless the reviewer specifically requested it
- If the fix requires more than ~15 lines of change, explain why before proceeding
- If you're unsure what the reviewer wants, say so instead of guessing`;

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
    String(Math.min(body.budget ?? 0.25, 1)),
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.GITHUB_TOKEN;
  env.ANTHROPIC_API_KEY = apiKey;
  if (ghToken) env.GITHUB_TOKEN = ghToken;

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
        releaseSlot("fix");
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, exit_code: code })}\n\n`,
          ),
        );
        controller.close();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        releaseSlot("fix");
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
