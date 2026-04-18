// POST /api/explore
// Calls MCP tool functions directly (grep, find_definition, read_file,
// repo_info) then synthesizes results with Gemini. No Claude subprocess
// needed — total cost is essentially one Gemini 2.0 Flash call (~$0.00).

import { NextRequest } from "next/server";
import { resolveGeminiKey, resolveAnthropicKey } from "@/lib/api-keys";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dynamically import the MCP tool functions from the built mcp-server.
// These are pure async functions — no MCP protocol overhead.
async function loadTools() {
  const tools = await import("../../../mcp-server/dist/tools.js");
  return tools;
}

// Extract likely search terms from a natural-language query.
function extractSearchTerms(query: string): string[] {
  // Remove common words, keep meaningful terms
  const stopWords = new Set([
    "where", "is", "the", "how", "does", "what", "are", "a", "an", "in",
    "of", "to", "and", "or", "for", "this", "that", "it", "do", "can",
    "show", "me", "find", "look", "at", "from", "with", "about", "used",
    "using", "which", "all", "any", "i", "my", "be", "have", "has",
    "was", "were", "been", "being", "get", "gets", "got", "did",
  ]);
  return query
    .replace(/[?!.,;:'"()\[\]{}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()))
    .slice(0, 8);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    repo_url?: string;
    query?: string;
  };

  if (!body.repo_url || !body.query) {
    return new Response(
      JSON.stringify({ error: "Missing repo_url or query" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Need at least one LLM key for synthesis
  const geminiKey = await resolveGeminiKey();
  const anthropicKey = await resolveAnthropicKey();
  if (!geminiKey && !anthropicKey) {
    return new Response(
      JSON.stringify({ error: "No API key configured. Add a Gemini or Anthropic key in Crucible → API Keys." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Parse owner/name
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

  // Set GITHUB_TOKEN for private repo access
  const token = await resolveGitHubToken();
  if (token) process.env.GITHUB_TOKEN = token;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const tools = await loadTools();
        const query = body.query!;
        const terms = extractSearchTerms(query);
        const gathered: string[] = [];

        // 1. Repo overview
        send({ tool: "repo_info", detail: "overview" });
        try {
          const info = await tools.repoInfo({ repo: repoFull });
          gathered.push(`## Repo Info\n${info}`);
        } catch (e) {
          gathered.push(`## Repo Info\nFailed: ${e instanceof Error ? e.message : String(e)}`);
        }

        // 2. Grep for each search term
        for (const term of terms) {
          send({ tool: "grep", detail: term });
          try {
            const result = await tools.grepTool({
              repo: repoFull,
              pattern: term,
              case_insensitive: true,
              max_matches: 30,
            });
            if (!result.includes("0 matches")) {
              gathered.push(`## Grep: ${term}\n${result}`);
            }
          } catch {
            // skip failed greps
          }
        }

        // 3. Try find_definition for terms that look like symbols
        const symbolTerms = terms.filter((t) => /^[A-Za-z_]\w*$/.test(t));
        for (const sym of symbolTerms.slice(0, 3)) {
          send({ tool: "find_definition", detail: sym });
          try {
            const result = await tools.findDefinition({ repo: repoFull, symbol: sym });
            if (!result.includes("No definition found")) {
              gathered.push(`## Definition: ${sym}\n${result}`);
            }
          } catch {
            // skip
          }
        }

        // 4. Read top files from grep hits (extract unique file paths, read first 3)
        const fileHits = new Set<string>();
        for (const section of gathered) {
          const matches = section.matchAll(/^([^\s:]+\.\w+):\d+:/gm);
          for (const fm of matches) fileHits.add(fm[1]);
        }
        const filesToRead = [...fileHits].slice(0, 4);
        for (const filePath of filesToRead) {
          send({ tool: "read_file", detail: filePath });
          try {
            const content = await tools.readFileTool({
              repo: repoFull,
              path: filePath,
              line_start: 1,
              line_end: 80,
            });
            gathered.push(`## File: ${filePath}\n${content}`);
          } catch {
            // skip unreadable files
          }
        }

        send({ tool: "synthesize", detail: "generating answer..." });

        // 5. Synthesize with Gemini (cheap) or Anthropic (fallback)
        const context = gathered.join("\n\n").slice(0, 60_000);
        const synthesisPrompt = [
          `You are a codebase navigator. The user asked about the repo "${repoFull}":`,
          ``,
          `"${query}"`,
          ``,
          `Below is raw output from searching the codebase (grep results, file contents, definitions). Use it to answer the question.`,
          ``,
          `Rules:`,
          `- Answer directly in 2-4 sentences at the top`,
          `- Show relevant file:line references`,
          `- Include key code snippets (5-30 lines) in fenced code blocks`,
          `- Be concise — don't repeat the raw search output`,
          `- If the answer isn't in the data below, say so`,
          ``,
          `--- RAW SEARCH DATA ---`,
          context,
        ].join("\n");

        let answer: string | null = null;

        if (geminiKey) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: synthesisPrompt }] }],
                  generationConfig: { maxOutputTokens: 4096 },
                }),
              },
            );
            if (res.ok) {
              const json = (await res.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              answer = json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
            }
          } catch {
            // fall through to Anthropic
          }
        }

        // Fallback: Anthropic (single cheap call with just the synthesis prompt)
        if (!answer && anthropicKey) {
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-5-20250514",
                max_tokens: 4096,
                messages: [{ role: "user", content: synthesisPrompt }],
              }),
            });
            if (res.ok) {
              const json = (await res.json()) as {
                content?: Array<{ text?: string }>;
              };
              answer = json.content?.[0]?.text ?? null;
            }
          } catch {
            // both failed
          }
        }

        if (answer) {
          send({ text: answer });
          // Gemini 2.0 Flash is essentially free; report $0.00
          send({ cost: 0.001 });
        } else {
          send({ text: "Failed to synthesize results. Raw search data was collected but the LLM call failed." });
        }

        send({ done: true, exit_code: 0 });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) });
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
}
