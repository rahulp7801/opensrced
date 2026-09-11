import { CLAUDE_FAST_MODEL } from "./models";
import { sseEvents } from "./sse";

/** Small text-only requests share cancellation, deadlines and error handling. */
export function anthropicStream(apiKey: string, system: string, user: string, maxTokens: number, requestSignal: AbortSignal, release = () => {}): Response {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal, AbortSignal.timeout(90_000)]);
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { if (!cancelled && !requestSignal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: CLAUDE_FAST_MODEL, max_tokens: maxTokens, system, stream: true, messages: [{ role: "user", content: user }] }),
        });
        if (!response.ok) throw new Error(`Provider request failed (${response.status}). Check your API key and balance.`);
        let inputTokens = 0, outputTokens = 0, complete = false;
        for await (const event of sseEvents<{ type: string; delta?: { text?: string }; usage?: { output_tokens?: number }; message?: { usage?: { input_tokens?: number } } }>(response)) {
          if (event.type === "error") throw new Error("The provider interrupted this request. Please retry.");
          if (event.type === "content_block_delta" && event.delta?.text) send({ text: event.delta.text });
          if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? 0;
          if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? outputTokens;
          if (event.type === "message_stop") complete = true;
        }
        if (!complete) throw new Error("The provider stream ended before completion. Please retry.");
        // Haiku 4.5 standard pricing: $1 input / $5 output per million tokens.
        // https://platform.claude.com/docs/en/about-claude/pricing
        send({ cost: (inputTokens + outputTokens * 5) / 1_000_000, done: true });
      } catch (error) {
        send({ error: signal.aborted ? "Request timed out. Please retry." : error instanceof Error ? error.message : "Request failed." });
      } finally {
        cancellation.abort();
        release();
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
