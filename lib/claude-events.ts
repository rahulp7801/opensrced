/** Why a Claude Code `result` event failed, phrased as what to do next, or
 *  null when it succeeded. Budget and turn limits fail the same way on retry,
 *  and a policy decline needs a different request, so they get their own words. */
export function claudeResultFailure(event: { is_error?: boolean; subtype?: string; stop_reason?: string }, fallback: string): string | null {
  if (event.subtype === "error_max_budget_usd") return "The run reached its spend limit before finishing. Narrow the task or raise the budget.";
  if (event.subtype === "error_max_turns") return "The run reached its step limit before finishing. Narrow the task and retry.";
  if (event.stop_reason === "refusal") return "The model declined this task. Rephrase it rather than retrying.";
  if (event.is_error || (event.subtype && event.subtype !== "success") || (event.stop_reason && event.stop_reason !== "end_turn")) return fallback;
  return null;
}

/** Convert Claude JSONL into the small SSE events consumed by exploration. */
export function claudeEvents(line: string): Record<string, unknown>[] {
  try {
    const event = JSON.parse(line);
    const events: Record<string, unknown>[] = [];
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "text" && typeof block.text === "string") events.push({ text: block.text });
        if (block.type === "tool_use" && typeof block.name === "string") {
          const tool = block.name.replace(/^mcp__opensrcer-repo-tools__/, "");
          const input = block.input ?? {};
          const detail = tool === "grep" ? `/${input.pattern ?? ""}/` : input.path ?? input.symbol ?? input.glob ?? (tool === "repo_info" ? "overview" : "root");
          events.push({ tool, detail: String(detail) });
        }
      }
    }
    if (event.type === "result") {
      if (typeof event.total_cost_usd === "number" && Number.isFinite(event.total_cost_usd)) events.push({ cost: event.total_cost_usd });
      const failure = claudeResultFailure(event, "Exploration could not complete. Check provider access and retry.");
      events.push(failure ? { error: failure } : { done: true });
    }
    return events;
  } catch { return []; }
}
