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
import {
  loadGraph,
  routeQuery,
  graphJsonPath,
  buildGraphSummary,
  FALLBACK_SENTINEL,
} from "@/lib/graph";
import { resolveAnthropicKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    query?: string;
  };

  if (!body.owner || !body.repo || !body.query) {
    return Response.json(
      { error: "Missing owner, repo, or query" },
      { status: 400 },
    );
  }

  const jsonPath = graphJsonPath(body.owner, body.repo);
  if (!existsSync(jsonPath)) {
    return Response.json(
      { error: "Graph not built yet. Click 'Build Graph' first." },
      { status: 404 },
    );
  }

  try {
    const graph = await loadGraph(body.owner, body.repo);

    // Try graph traversal first (free)
    const result = routeQuery(graph, body.query);

    // If the query matched a command or node, return instant JSON
    if (!result.startsWith(FALLBACK_SENTINEL)) {
      return Response.json({ result, cost: 0 });
    }

    // LLM fallback — use Anthropic API with graph context
    const apiKey = await resolveAnthropicKey();
    if (!apiKey) {
      // No API key — return the graph help text instead
      return Response.json({ result, cost: 0 });
    }

    const summary = buildGraphSummary(graph);
    const systemPrompt = `You are a codebase analysis assistant. You have access to a knowledge graph of the ${body.owner}/${body.repo} GitHub repository. Answer the user's question using ONLY the graph data provided below. Be concise and specific — cite file paths and function names. If the graph data doesn't contain enough information to answer, say so honestly.

GRAPH DATA:
${summary}`;

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
          send({ done: true, mode: "llm" });
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
