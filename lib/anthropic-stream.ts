import { CLAUDE_AGENT_MODEL, CLAUDE_FAST_MODEL } from "./models";
import { sseEvents } from "./sse";
import { sensitiveTextKind } from "./sensitive-text";

/** What the user can do about a failed provider response, by HTTP status. */
function providerFailure(status: number): string {
  if (status === 401 || status === 403) return "The Anthropic API key was rejected. Check it in Settings.";
  if (status === 429) return "Anthropic rate-limited this key. Wait a minute and retry.";
  if (status === 529 || status >= 500) return "Anthropic is overloaded or unavailable right now. Please retry shortly.";
  // 400s include "credit balance is too low", which only the provider body names.
  return `Provider request failed (${status}). Check your API key and balance.`;
}

/** $ per million tokens. Cache writes (5-minute) cost 1.25x input, reads 0.1x.
 *  https://platform.claude.com/docs/en/about-claude/pricing */
const PRICING: Record<string, { input: number; output: number }> = {
  [CLAUDE_FAST_MODEL]: { input: 1, output: 5 },
  [CLAUDE_AGENT_MODEL]: { input: 2, output: 10 },
};

export type AnthropicUsage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };

/** What one request cost, from its usage. Unknown models are priced as the agent model. */
export function anthropicCost(model: string, usage: AnthropicUsage): number {
  const price = PRICING[model] ?? PRICING[CLAUDE_AGENT_MODEL];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000;
}

export type AnthropicTurn = { role: "user" | "assistant"; content: string };
export type AnthropicRequest = {
  model: string;
  system: string;
  messages: AnthropicTurn[];
  maxTokens: number;
  /** Mark the system prompt as a cache breakpoint: the stable prefix of a
   *  multi-turn conversation (the lesson teacher). Below the model's minimum
   *  (1024 tokens on Sonnet, 4096 on Haiku 4.5) it silently does not cache. */
  cacheSystem?: boolean;
};

/** Small text-only requests share cancellation, deadlines and error handling. */
export function anthropicStream(apiKey: string, system: string, user: string, maxTokens: number, requestSignal: AbortSignal, release = () => {}): Response {
  return anthropicMessagesStream(apiKey, { model: CLAUDE_FAST_MODEL, system, messages: [{ role: "user", content: user }], maxTokens }, requestSignal, release);
}

/** One streamed Messages API request, re-emitted as `{ text }` events and a
 *  final `{ cost, done }` (or `{ error }`): the shape lib/sse.ts reads. */
export function anthropicMessagesStream(apiKey: string, request: AnthropicRequest, requestSignal: AbortSignal, release = () => {}): Response {
  const { model, system, messages, maxTokens } = request;
  const sensitive = sensitiveTextKind([system, ...messages.map((m) => m.content)]);
  if (sensitive) {
    release();
    return Response.json({ error: `Request content appears to contain a ${sensitive}. Remove sensitive values before retrying.` }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal, AbortSignal.timeout(90_000)]);
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { if (!cancelled && !requestSignal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal, redirect: "error",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model, max_tokens: maxTokens, stream: true, messages,
            system: request.cacheSystem ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
          }),
        });
        if (!response.ok) throw new Error(providerFailure(response.status));
        let usage: AnthropicUsage = {};
        let complete = false, hasText = false;
        let stopReason: string | undefined;
        for await (const event of sseEvents<{ type: string; delta?: { text?: string; stop_reason?: string }; usage?: { output_tokens?: number }; message?: { usage?: AnthropicUsage }; error?: { type?: string } }>(response)) {
          if (event.type === "error") throw new Error(event.error?.type === "overloaded_error" ? providerFailure(529) : "The provider interrupted this request. Please retry.");
          if (event.type === "content_block_delta" && event.delta?.text) {
            hasText ||= Boolean(event.delta.text.trim());
            send({ text: event.delta.text });
          }
          if (event.type === "message_start") usage = { ...event.message?.usage };
          if (event.type === "message_delta") {
            usage.output_tokens = event.usage?.output_tokens ?? usage.output_tokens;
            stopReason = event.delta?.stop_reason ?? stopReason;
          }
          if (event.type === "message_stop") { complete = true; break; }
        }
        if (!complete) throw new Error("The provider stream ended before completion. Please retry.");
        if (stopReason === "max_tokens") throw new Error("The answer reached its length limit before finishing. Try a narrower request.");
        // Retrying the same request will not change a policy decline.
        if (stopReason === "refusal") throw new Error("The model declined to answer this request. Rephrase it rather than retrying.");
        if (stopReason !== "end_turn" || !hasText) throw new Error("The provider did not return a completed answer. Please retry.");
        send({ cost: anthropicCost(model, usage), done: true });
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
