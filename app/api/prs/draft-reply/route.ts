// POST /api/prs/draft-reply
// Uses the Anthropic API directly (no MCP tools, no code exploration)
// to draft a reply to a reviewer's question. Fast and cheap (~$0.001).

import { NextRequest } from "next/server";
import { resolveAnthropicKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo?: string;
    pr_title?: string;
    pr_body?: string;
    comment_body?: string;
    comment_author?: string;
    file_path?: string | null;
  };

  if (!body.comment_body) {
    return Response.json({ error: "Missing comment_body" }, { status: 400 });
  }

  const apiKey = await resolveAnthropicKey();
  if (!apiKey) {
    return Response.json({ error: "No Anthropic API key configured." }, { status: 400 });
  }

  const systemPrompt = `You are the author of a pull request on ${body.repo ?? "a GitHub repo"}. A reviewer left a comment and you need to draft a concise, professional reply.

PR title: ${body.pr_title ?? "N/A"}
${body.file_path ? `File: ${body.file_path}` : ""}

Rules:
- Be concise (2-4 sentences max)
- Be professional and collaborative
- If they asked a technical question, answer it directly
- If they made a suggestion, acknowledge it
- Don't be defensive or overly apologetic
- Don't use emojis`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            system: systemPrompt,
            stream: true,
            messages: [{
              role: "user",
              content: `Reviewer ${body.comment_author ?? "someone"} wrote:\n"${body.comment_body}"\n\nDraft a reply:`,
            }],
          }),
        });

        if (!res.ok) {
          send({ error: `API error: ${res.status}` });
          send({ done: true });
          controller.close();
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) { send({ done: true }); controller.close(); return; }

        const decoder = new TextDecoder();
        let buf = "";

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
              };
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                send({ text: evt.delta.text });
              }
            } catch { /* skip */ }
          }
        }

        send({ done: true });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
        send({ done: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
