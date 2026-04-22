// POST /api/graph/query
// First tries pure JS graph traversal (free). If the query doesn't
// match any command or node, falls back to the Anthropic API with
// graph context to answer in natural language.
//
// Response modes:
//   - Graph hit:  JSON { result, cost: 0 }
//   - LLM fallback: SSE stream with { text }, { cost }, { done }

import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  loadGraph,
  routeQuery,
  graphJsonPath,
  buildGraphSummary,
  FALLBACK_SENTINEL,
} from "@/lib/graph";
import { hasCrg, graphCacheDir } from "@/lib/graph-build";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { getCached, setCached } from "@/lib/llm-cache";
import { sanitizeForPrompt } from "@/lib/sanitize";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    query?: string;
  };

  // Sanitize — owner/repo are validated by path convention, query is user freetext
  const body = {
    owner: raw.owner?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100),
    repo: raw.repo?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100),
    query: raw.query ? sanitizeForPrompt(raw.query) : null,
  };

  if (!body.owner || !body.repo || !body.query) {
    return Response.json(
      { error: "Missing owner, repo, or query" },
      { status: 400 },
    );
  }

  const jsonPath = graphJsonPath(body.owner, body.repo);
  const hasCrgData = hasCrg(body.owner, body.repo);
  const hasGraphify = existsSync(jsonPath);
  const engine = hasGraphify ? "graphify" : hasCrgData ? "crg" : null;

  if (!engine) {
    return Response.json(
      { error: "Graph not built yet. Click 'Build Graph' first." },
      { status: 404 },
    );
  }

  try {
    // If graphify data exists, try free graph commands first
    if (hasGraphify) {
      const graph = await loadGraph(body.owner, body.repo);
      const result = routeQuery(graph, body.query);

      if (!result.startsWith(FALLBACK_SENTINEL)) {
        return Response.json({ result, cost: 0, engine: "graphify" });
      }
    }

    // CRG-only or LLM fallback — all queries use AI
    const apiKey = await resolveAnthropicKey();
    if (!apiKey) {
      const msg = engine === "crg"
        ? "This repo uses code-review-graph (large repo mode). All queries require an Anthropic API key since free graph commands are not available."
        : `${FALLBACK_SENTINEL} Type "help" for available commands, or configure an Anthropic API key for AI-powered answers.`;
      return Response.json({ result: msg, cost: 0, engine });
    }

    // Build summary from graphify (preferred) or CRG (fallback)
    let summary: string;
    if (existsSync(jsonPath)) {
      const graph = await loadGraph(body.owner, body.repo);
      summary = buildGraphSummary(graph);
    } else {
      summary = await getCrgSummary(body.owner, body.repo);
    }

    // Compress the graph summary with LLMLingua-2 to reduce tokens
    const compressed = await compressWithLLMLingua(summary);

    const model = "claude-haiku-4-5-20251001";
    const systemPrompt = `You are a codebase analysis assistant. You have access to a knowledge graph of the ${body.owner}/${body.repo} GitHub repository. Answer the user's question using ONLY the graph data provided below. Be concise and specific — cite file paths and function names. If the graph data doesn't contain enough information to answer, say so honestly.

GRAPH DATA:
${compressed.text}`;

    // Check cache first — return instant JSON if hit
    const cached = await getCached(model, systemPrompt, body.query);
    if (cached) {
      return Response.json({
        result: cached.response,
        cost: 0,
        cached: true,
      });
    }

    // Stream the response via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        }

        try {
          const res = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1024,
                system: systemPrompt,
                stream: true,
                messages: [{ role: "user", content: body.query }],
              }),
            },
          );

          if (!res.ok) {
            const err = await res.text();
            send({ error: `Anthropic API error: ${res.status} ${err.slice(0, 200)}` });
            send({ done: true });
            controller.close();
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            send({ error: "No response body" });
            send({ done: true });
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buf = "";
          let inputTokens = 0;
          let outputTokens = 0;
          let fullResponse = "";

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
                  delta?: { type?: string; text?: string };
                  message?: { usage?: { input_tokens?: number } };
                  usage?: { output_tokens?: number };
                };

                if (
                  evt.type === "content_block_delta" &&
                  evt.delta?.type === "text_delta" &&
                  evt.delta.text
                ) {
                  fullResponse += evt.delta.text;
                  send({ text: evt.delta.text });
                }

                if (evt.type === "message_start" && evt.message?.usage) {
                  inputTokens = evt.message.usage.input_tokens ?? 0;
                }
                if (evt.type === "message_delta" && evt.usage) {
                  outputTokens = evt.usage.output_tokens ?? 0;
                }
              } catch {
                /* skip malformed SSE */
              }
            }
          }

          // Haiku pricing: $0.80/M input, $4/M output
          const cost =
            (inputTokens * 0.8) / 1_000_000 +
            (outputTokens * 4) / 1_000_000;
          send({ cost: Math.round(cost * 10000) / 10000 });
          send({
            done: true,
            mode: "llm",
            compression: compressed.ratio !== "1.0x"
              ? `LLMLingua-2: ${compressed.originalTokens} → ${compressed.compressedTokens} tokens (${compressed.ratio})`
              : undefined,
          });

          // Cache the response for future identical queries
          if (fullResponse) {
            setCached(model, systemPrompt, body.query!, fullResponse, inputTokens, outputTokens).catch(() => {});
          }
        } catch (err) {
          send({
            error:
              err instanceof Error ? err.message : String(err),
          });
          send({ done: true });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── LLMLingua-2 prompt compression ────────────────────────────────────

type CompressionResult = {
  text: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: string;
};

async function compressWithLLMLingua(text: string): Promise<CompressionResult> {
  // Skip for short texts — compression overhead isn't worth it
  if (text.length < 300) {
    return { text, originalTokens: text.split(/\s+/).length, compressedTokens: text.split(/\s+/).length, ratio: "1.0x" };
  }

  try {
    const { writeFile: wf, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tmpDir = await mkdtemp(join(tmpdir(), "llmlingua-"));
    const inputPath = join(tmpDir, "input.txt");
    await wf(inputPath, text);

    const scriptPath = join(process.cwd(), "lib", "compress-prompt.py");
    // Pipe via file since execFile doesn't support stdin
    const { stdout } = await execFileAsync(
      "python",
      ["-c", `
import sys, json
with open(r'${inputPath.replace(/\\/g, "\\\\")}', 'r', encoding='utf-8') as f:
    sys.stdin = f
    exec(open(r'${scriptPath.replace(/\\/g, "\\\\")}').read())
`],
      {
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        timeout: 60_000,
      },
    );

    rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    const result = JSON.parse(stdout) as {
      compressed_prompt: string;
      origin_tokens: number;
      compressed_tokens: number;
      ratio: string;
      error?: string;
    };

    return {
      text: result.compressed_prompt,
      originalTokens: result.origin_tokens,
      compressedTokens: result.compressed_tokens,
      ratio: result.ratio,
    };
  } catch {
    // Compression failed — return original (fail-open)
    return { text, originalTokens: text.split(/\s+/).length, compressedTokens: text.split(/\s+/).length, ratio: "1.0x" };
  }
}

// ── CRG summary for LLM context ──────────────────────────────────────

async function getCrgSummary(owner: string, repo: string): Promise<string> {
  const repoDir = graphCacheDir(owner, repo);
  const scriptPath = join(process.cwd(), "lib", "crg-summary.py");
  const pythonPath = process.env.CRG_PYTHONPATH ?? "C:/Users/rahul/crg-pkg";

  try {
    const { stdout } = await execFileAsync(
      "python",
      [scriptPath, repoDir],
      {
        env: { ...process.env, PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" },
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        timeout: 15_000,
      },
    );

    const data = JSON.parse(stdout) as {
      nodes?: number;
      edges?: number;
      files?: number;
      top_files?: Array<{ file: string; nodes: number }>;
      edge_kinds?: Record<string, number>;
      sample_edges?: string[];
      error?: string;
    };

    if (data.error) return `Graph data unavailable: ${data.error}`;

    const topFiles = (data.top_files ?? [])
      .map((f) => `${f.file} (${f.nodes} symbols)`)
      .join("; ");
    const edgeKinds = Object.entries(data.edge_kinds ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const edges = (data.sample_edges ?? []).join("\n");

    return [
      `Codebase graph (code-review-graph): ${data.nodes ?? 0} nodes, ${data.edges ?? 0} edges, ${data.files ?? 0} files`,
      "",
      `Key files: ${topFiles}`,
      "",
      `Relationship types: ${edgeKinds}`,
      "",
      `Sample edges:\n${edges}`,
    ].join("\n");
  } catch {
    return "Graph summary unavailable";
  }
}
