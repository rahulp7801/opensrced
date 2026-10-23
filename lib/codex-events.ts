// Codex CLI `exec --json` events, read into the same shapes the Claude path
// produces: run-log text for lib/agentic-pr.ts (## Diagnosis, ```diff, ## PR
// title, ## PR body all come from the agent's messages) and the small SSE
// events exploration streams.
//
// Event stream (codex-cli 0.164, learn.chatgpt.com/docs/non-interactive-mode):
//   thread.started, turn.started, item.started / item.updated / item.completed,
//   turn.completed {usage}, turn.failed {error: {message}}, error {message}.
// Items we read: agent_message {text}, mcp_tool_call {server, tool, arguments,
// status: in_progress|completed|failed, error: {message} | null}.

import { StringDecoder } from "node:string_decoder";
import { sanitizeLogValue } from "./sanitize";

/** A failure that means the plan cannot serve this run right now (usage cap,
 *  rate limit, signed out), so an opted-in API-key fallback may take over. */
export function planUnavailable(message: string): boolean {
  return /usage limit|hit your limit|rate.?limit|quota|limit reached|not logged in|please run \/login|log ?in again|unauthori[sz]ed|token (has )?expired|401/i.test(message);
}

type CodexItem = { type?: string; text?: string; tool?: string; arguments?: unknown; status?: string; error?: { message?: string } | null };

/** First string argument besides the repo: a path, pattern or symbol. */
function toolDetail(args: unknown): string {
  let parsed = args;
  if (typeof args === "string") { try { parsed = JSON.parse(args); } catch { return ""; } }
  if (!parsed || typeof parsed !== "object") return "";
  const value = Object.entries(parsed).find(([k, v]) => k !== "repo" && typeof v === "string")?.[1];
  return typeof value === "string" ? value : "";
}

/** Convert one Codex JSONL line into exploration SSE events. */
export function codexEvents(line: string): Record<string, unknown>[] {
  let event: { type?: string; item?: CodexItem; error?: { message?: string }; message?: string };
  try { event = JSON.parse(line); } catch { return []; }
  const events: Record<string, unknown>[] = [];
  if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
    events.push({ text: event.item.text });
  }
  if (event.type === "item.started" && event.item?.type === "mcp_tool_call" && typeof event.item.tool === "string") {
    events.push({ tool: event.item.tool, detail: toolDetail(event.item.arguments) || "root" });
  }
  if (event.type === "turn.completed") events.push({ done: true });
  if (event.type === "turn.failed") {
    const message = sanitizeLogValue(event.error?.message ?? "", 300);
    events.push({ error: planUnavailable(message) ? `Your ChatGPT plan could not serve this run: ${message}` : "The run could not complete. Check provider access and retry." });
  }
  return events;
}

/** Codex counterpart of pipeStreamJson (lib/agentic-dispatcher.ts): write the
 *  agent's messages and tool calls to the run log and report completion. */
export function pipeCodexJson(
  stdout: import("node:stream").Readable,
  out: Pick<import("node:fs").WriteStream, "write">,
): { complete: boolean; failed: boolean; unavailable: boolean } {
  const state = { complete: false, failed: false, unavailable: false };
  const decoder = new StringDecoder("utf8");
  let buf = "";
  let toolCalls = 0;
  function consume(line: string) {
    if (!line.trim()) return;
    let event: { type?: string; item?: CodexItem; usage?: Record<string, unknown>; error?: { message?: string }; message?: string };
    try { event = JSON.parse(line); } catch { state.failed = true; return; }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      out.write(event.item.text + "\n");
    }
    if (event.type === "item.started" && event.item?.type === "mcp_tool_call" && typeof event.item.tool === "string") {
      out.write(`\n[tool] ${sanitizeLogValue(event.item.tool, 40)} ${sanitizeLogValue(toolDetail(event.item.arguments), 100)}\n`);
    }
    // Only a call that returned counts: a refused one ("requires approval")
    // leaves the agent writing a fix it never grounded in the repo.
    if (event.type === "item.completed" && event.item?.type === "mcp_tool_call") {
      if (event.item.status === "completed" && !event.item.error) toolCalls++;
      else out.write(`[tool] ${sanitizeLogValue(event.item.tool, 40)} failed: ${sanitizeLogValue(event.item.error?.message ?? event.item.status, 160)}\n`);
    }
    if (event.type === "turn.completed") {
      // Plan usage has no dollar cost; record tokens so the run shows its size.
      const usage = event.usage ?? {};
      const tokens = ["input_tokens", "output_tokens"].map((k) => `${k}=${Number(usage[k]) || 0}`).join(" ");
      out.write(`\n[agentic-dispatcher] plan usage: ${tokens}\n`);
      // Same rule as the Claude path: no real tool call, no result.
      if (toolCalls === 0) {
        state.failed = true;
        out.write("\n[agentic-dispatcher] The agent made no repository tool calls, so its output is discarded.\n");
      } else state.complete = true;
    }
    // A top-level `error` can be a retry notice; only turn.failed ends the
    // run. Either can say the plan is out of quota or signed out.
    if (event.type === "turn.failed" || event.type === "error") {
      const message = sanitizeLogValue(event.error?.message ?? event.message ?? "unknown error", 300);
      if (event.type === "turn.failed") state.failed = true;
      state.unavailable ||= planUnavailable(message);
      out.write(`\n[agentic-dispatcher] Codex reported: ${message}\n`);
    }
  }
  stdout.on("data", (chunk: Buffer) => {
    buf += decoder.write(chunk);
    if (buf.length > 1_000_000) { state.failed = true; buf = ""; return; }
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) consume(line);
  });
  stdout.on("end", () => { consume(buf + decoder.end()); });
  return state;
}
