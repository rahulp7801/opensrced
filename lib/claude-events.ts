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
      if (typeof event.total_cost_usd === "number") events.push({ cost: event.total_cost_usd });
      if (event.is_error) events.push({ error: "Exploration could not complete. Check provider access and retry." });
    }
    return events;
  } catch { return []; }
}
