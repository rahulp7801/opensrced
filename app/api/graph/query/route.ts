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
  buildFullGraphContext,
  FALLBACK_SENTINEL,
} from "@/lib/graph";
import { hasCrg, graphCacheDir } from "@/lib/graph-build";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { getCached, setCached } from "@/lib/llm-cache";
import { sanitizeForPrompt, sanitizeRepoId, sanitizeFilePath } from "@/lib/sanitize";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    query?: string;
  };

  // Sanitize all inputs
  const fullRepo = raw.owner && raw.repo ? `${raw.owner}/${raw.repo}` : null;
  const sanitizedRepo = fullRepo ? sanitizeRepoId(fullRepo) : null;
  const body = {
    owner: sanitizedRepo?.split("/")[0] ?? null,
    repo: sanitizedRepo?.split("/")[1] ?? null,
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

    // CRG direct commands — handle blast radius / impact queries without LLM
    if (hasCrgData) {
      const crgResult = await tryCrgCommand(body.owner, body.repo, body.query);
      if (crgResult) {
        return Response.json({ result: crgResult, cost: 0, engine: "crg" });
      }
    }

    // LLM fallback — all other queries use AI
    const apiKey = await resolveAnthropicKey();
    if (!apiKey) {
      const msg = engine === "crg"
        ? "This repo uses code-review-graph (large repo mode). All queries require an Anthropic API key since free graph commands are not available."
        : `${FALLBACK_SENTINEL} Type "help" for available commands, or configure an Anthropic API key for AI-powered answers.`;
      return Response.json({ result: msg, cost: 0, engine });
    }

    // Decide whether the LLM needs the full graph or just a summary.
    // Full graph: when the user asks about specific connections, dependencies,
    //   data flow, specific functions/classes, or anything requiring precise
    //   node/edge data to answer correctly.
    // Summary: general architecture questions, "what does this repo do",
    //   tech stack questions, high-level structure.
    const needsFull = queryNeedsFullGraph(body.query);

    let graphContext: string;
    if (existsSync(jsonPath)) {
      const graph = await loadGraph(body.owner, body.repo);
      graphContext = needsFull ? buildFullGraphContext(graph) : buildGraphSummary(graph);
    } else {
      // CRG — full dump is handled by getCrgSummary with a depth flag
      graphContext = await getCrgSummary(body.owner, body.repo, needsFull);
    }

    // Compress the USER QUERY with LLMLingua-2 to reduce input tokens
    const compressed = await compressWithLLMLingua(body.query);
    const userQuery = compressed.text;

    const model = "claude-haiku-4-5-20251001";
    const systemPrompt = `You are a codebase analysis assistant. You have access to a knowledge graph of the ${body.owner}/${body.repo} GitHub repository. Answer the user's question using ONLY the graph data provided below. Be concise and specific — cite file paths and function names. If the graph data doesn't contain enough information to answer, say so honestly.

GRAPH DATA:
${graphContext}`;

    // Check cache first — return instant JSON if hit
    const cached = await getCached(model, systemPrompt, userQuery);
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
                messages: [{ role: "user", content: userQuery }],
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
            setCached(model, systemPrompt, userQuery, fullResponse, inputTokens, outputTokens).catch(() => {});
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

// ── Query depth classification ────────────────────────────────────────
// Determines if a query needs full graph data or just a summary.

function queryNeedsFullGraph(query: string): boolean {
  const ql = query.toLowerCase();

  // Needs full graph: questions about specific connections, dependencies,
  // data flow, function relationships, "how does X connect to Y",
  // "what calls X", "what depends on X", listing all of something
  const fullPatterns = [
    /\bconnect|relate|depend|import|call|reference|inherit/,
    /\bdata flow|control flow|execution path/,
    /\bhow does .+ (?:work|interact|communicate)/,
    /\bwhat (?:calls|uses|imports|depends|references)/,
    /\blist all|show all|every|all the/,
    /\bspecific|exact|precise/,
    /\bbetween .+ and/,
    /\bwhere is .+ (?:used|called|defined|imported)/,
    /\bwhich (?:files|functions|classes|modules) /,
    /\bdependenc(?:y|ies)/,
    /\bcoupling|cohesion/,
    /\bentry point|main function|initialization/,
    /\btest coverage|which tests/,
  ];

  for (const pat of fullPatterns) {
    if (pat.test(ql)) return true;
  }

  return false;
}

// ── CRG direct commands ───────────────────────────────────────────────
// Handle impact/blast radius queries directly via CRG without LLM.

async function tryCrgCommand(
  owner: string,
  repo: string,
  query: string,
): Promise<string | null> {
  const ql = query.toLowerCase().trim();

  // Match any query that contains a file path (has a dot extension or slash separators).
  // Commands like "impact X" are explicit; natural language like "what about X.cpp" also works.
  let filePath: string | null = null;

  if (ql.startsWith("impact ") || ql.startsWith("blast radius ")) {
    filePath = query.replace(/^(?:impact|blast radius)\s+/i, "").trim();
  } else if (ql.startsWith("trace ")) {
    filePath = query.replace(/^trace\s+/i, "").trim();
  } else if (ql.startsWith("explain ")) {
    filePath = query.replace(/^explain\s+/i, "").trim();
  } else {
    // Extract any file path from the query — anything with a file extension
    // or directory separators (e.g. src/foo/bar.cpp, NativeLibrary.kt, utils.py)
    const pathMatch = query.match(/[`"']?([^\s`"'?]*\/[^\s`"'?]+\.\w{1,5}|[A-Za-z_][\w.-]*\.\w{1,5})[`"']?/);
    if (pathMatch) filePath = pathMatch[1];
  }

  if (!filePath) return null;

  // Clean up and sanitize the path
  filePath = filePath.replace(/[`"'?]/g, "").trim();
  if (filePath.length < 3) return null;
  filePath = sanitizeFilePath(filePath);
  if (!filePath) return null;

  const repoDir = graphCacheDir(owner, repo);
  const scriptPath = join(process.cwd(), "lib", "crg-impact.py");
  const pythonPath = process.env.CRG_PYTHONPATH ?? "C:/Users/rahul/crg-pkg";

  try {
    const { stdout } = await execFileAsync(
      "python",
      [scriptPath, repoDir, filePath],
      {
        env: { ...process.env, PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" },
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        timeout: 30_000,
      },
    );

    const data = JSON.parse(stdout) as {
      total_affected?: number;
      changed_nodes?: number;
      changed_labels?: string[];
      affected_files?: string[];
      affected_labels?: string[];
      affected_file_count?: number;
      truncated?: boolean;
      detail?: string;
      error?: string;
    };

    if (data.error) return null; // fall through to LLM

    if (data.total_affected === 0) {
      return `BLAST RADIUS: ${filePath}\n${"─".repeat(40)}\n${data.detail ?? "No downstream dependents found for this file."}\n\nThe file may be a leaf node with no callers, or it may not be indexed.`;
    }

    const lines: string[] = [
      `BLAST RADIUS: ${filePath}`,
      "─".repeat(40),
      `Changed nodes: ${data.changed_nodes}`,
      `Downstream dependents: ${data.total_affected}${data.truncated ? " (truncated)" : ""}`,
      `Affected files: ${data.affected_file_count}`,
      "",
    ];

    if (data.changed_labels && data.changed_labels.length > 0) {
      lines.push("SYMBOLS IN THIS FILE:");
      for (const l of data.changed_labels.slice(0, 10)) {
        // Clean up absolute paths
        const clean = l.replace(/C:\\[^(]+(\\[^(]+)/, (_, name) => name.replace(/\\/g, "/"));
        lines.push(`  ${clean}`);
      }
      lines.push("");
    }

    if (data.affected_files && data.affected_files.length > 0) {
      lines.push("AFFECTED FILES:");
      for (const f of data.affected_files) {
        // Make relative
        const rel = f.replace(/.*graph-cache[/\\][^/\\]+[/\\]/, "").replace(/\\/g, "/");
        lines.push(`  ${rel}`);
      }
      lines.push("");
    }

    if (data.affected_labels && data.affected_labels.length > 0) {
      lines.push("AFFECTED SYMBOLS:");
      for (const l of data.affected_labels.slice(0, 10)) {
        lines.push(`  ${l}`);
      }
      if (data.affected_labels.length > 10) {
        lines.push(`  ... and ${data.affected_labels.length - 10} more`);
      }
    }

    const risk = (data.total_affected ?? 0) > 30 ? "HIGH" :
      (data.total_affected ?? 0) > 10 ? "MEDIUM" : "LOW";
    lines.push("", `RISK: ${risk}`);
    lines.push("", "(code-review-graph, $0.00)");

    return lines.join("\n");
  } catch {
    return null; // fall through to LLM
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

async function getCrgSummary(owner: string, repo: string, full = false): Promise<string> {
  const repoDir = graphCacheDir(owner, repo);
  const scriptPath = join(process.cwd(), "lib", "crg-summary.py");
  const pythonPath = process.env.CRG_PYTHONPATH ?? "C:/Users/rahul/crg-pkg";

  try {
    const { stdout } = await execFileAsync(
      "python",
      [scriptPath, repoDir, ...(full ? ["--full"] : [])],
      {
        env: { ...process.env, PYTHONPATH: pythonPath, PYTHONIOENCODING: "utf-8" },
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
        timeout: 30_000,
      },
    );

    const data = JSON.parse(stdout) as {
      nodes?: number;
      edges?: number;
      files?: number;
      top_files?: Array<{ file: string; symbols: string[]; count: number }>;
      edge_kinds?: Record<string, number>;
      sample_edges?: string[];
      error?: string;
    };

    if (data.error) return `Graph data unavailable: ${data.error}`;

    const heading = full ? "ALL FILES AND SYMBOLS" : "TOP FILES BY SYMBOL COUNT";
    const lines: string[] = [
      `Codebase knowledge graph (code-review-graph): ${data.nodes ?? 0} nodes, ${data.edges ?? 0} edges, ${data.files ?? 0} files`,
      "",
      `${heading}:`,
    ];

    for (const fd of data.top_files ?? []) {
      lines.push(`\n[${fd.file}] (${fd.count} nodes)`);
      for (const sym of fd.symbols) {
        lines.push(`  ${sym}`);
      }
    }

    const edgeKinds = Object.entries(data.edge_kinds ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push("", `RELATIONSHIP TYPES: ${edgeKinds}`);

    lines.push("", `${full ? "ALL" : "SAMPLE"} EDGES:`);
    for (const e of data.sample_edges ?? []) {
      lines.push(`  ${e}`);
    }

    const result = lines.join("\n");
    if (result.length > 100_000) {
      return result.slice(0, 100_000) + "\n\n[... truncated]";
    }
    return result;
  } catch {
    return "Graph data unavailable";
  }
}
