// The teacher's engine (PLAN §7.3 as amended by §0.6): one interface,
// `send(messages, opts)`, returning the same SSE stream as
// lib/anthropic-stream.ts (`{ text }` events, then `{ cost, done }` or
// `{ error }`), with three adapters:
//
//   anthropic-key    the user's Anthropic key, Messages API, prompt caching on
//                    the stable system prefix (lib/anthropic-stream.ts)
//   openrouter-key   the user's OpenRouter key, OpenAI-compatible chat completions
//   copilot          the GitHub Copilot SDK on the user's GitHub sign-in; gated
//                    behind OPENSRCER_COPILOT_TEACHER=1 (see copilotRuntime)
//
// There is deliberately no Claude-subscription teacher: Anthropic's terms
// forbid using a user's Claude plan as the engine of our feature (§0.6).
// Signed in with Claude only, the teacher is unavailable until Copilot or a
// key is connected (TEACHER_UNAVAILABLE).

import { anthropicMessagesStream } from "../anthropic-stream";
import { CLAUDE_AGENT_MODEL, CLAUDE_FAST_MODEL } from "../models";
import { sensitiveTextKind } from "../sensitive-text";
import { sseEvents } from "../sse";
import { readGeneration } from "../understanding";
import type { Env, TeacherProvider } from "./budget";

export type RuntimeMessage = { role: "user" | "assistant"; content: string };

export type SendOptions = {
  system: string;
  /** teacher: the conversation (Sonnet-class). grader: short strict-JSON checks (the fast model). */
  tier: "teacher" | "grader";
  maxTokens: number;
  signal: AbortSignal;
};

export interface TeacherRuntime {
  readonly provider: TeacherProvider;
  /** One model call. Never throws: failures arrive as an `{ error }` event. */
  send(messages: RuntimeMessage[], opts: SendOptions): Response;
}

export const TEACHER_UNAVAILABLE = "The teacher needs GitHub Copilot or your own API key (Anthropic or OpenRouter). Connect one in Settings. A Claude plan runs the hidden fix only.";

/** The text and cost of one finished call. Throws the call's error. */
export async function complete(runtime: TeacherRuntime, messages: RuntimeMessage[], opts: SendOptions): Promise<{ text: string; cost: number }> {
  return readGeneration(runtime.send(messages, opts));
}

// ── Anthropic key ──────────────────────────────────────────────────────────

/** Model ids per tier; knobs: OPENSRCER_ANTHROPIC_TEACHER_MODEL / _GRADER_MODEL. */
export function anthropicModels(env: Env = process.env): { teacher: string; grader: string } {
  return { teacher: env.OPENSRCER_ANTHROPIC_TEACHER_MODEL || CLAUDE_AGENT_MODEL, grader: env.OPENSRCER_ANTHROPIC_GRADER_MODEL || CLAUDE_FAST_MODEL };
}

export function anthropicRuntime(apiKey: string, models = anthropicModels()): TeacherRuntime {
  return {
    provider: "anthropic-key",
    send: (messages, opts) => anthropicMessagesStream(apiKey, {
      model: models[opts.tier], system: opts.system, messages, maxTokens: opts.maxTokens,
      // The system prompt (rules, issue, answer key) is the same every turn of a lesson.
      cacheSystem: opts.tier === "teacher",
    }, opts.signal),
  };
}

// ── Shared stream plumbing for the non-Anthropic adapters ─────────────────

type Emit = (text: string) => void;

/** An SSE Response fed by `run`, which emits text and resolves to the cost.
 *  Same guarantees as anthropicMessagesStream: a credential-looking request
 *  never leaves, a deadline applies, and only a finished answer says done. */
function eventStream(contents: string[], requestSignal: AbortSignal, run: (emit: Emit, signal: AbortSignal) => Promise<number>): Response {
  const sensitive = sensitiveTextKind(contents);
  if (sensitive) return Response.json({ error: `Request content appears to contain a ${sensitive}. Remove sensitive values before retrying.` }, { status: 422, headers: { "Cache-Control": "no-store" } });
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal, AbortSignal.timeout(90_000)]);
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => { if (!cancelled && !requestSignal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
      let hasText = false;
      try {
        const cost = await run((text) => { hasText ||= Boolean(text.trim()); send({ text }); }, signal);
        if (!hasText) throw new Error("The provider did not return a completed answer. Please retry.");
        send({ cost, done: true });
      } catch (error) {
        send({ error: signal.aborted ? "Request timed out. Please retry." : error instanceof Error ? error.message : "Request failed." });
      } finally {
        cancellation.abort();
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}

// ── OpenRouter key ─────────────────────────────────────────────────────────

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter model ids per tier; knobs: OPENSRCER_OPENROUTER_TEACHER_MODEL / _GRADER_MODEL. */
export function openRouterModels(env: Env = process.env): { teacher: string; grader: string } {
  return {
    teacher: env.OPENSRCER_OPENROUTER_TEACHER_MODEL || "anthropic/claude-sonnet-5",
    grader: env.OPENSRCER_OPENROUTER_GRADER_MODEL || "anthropic/claude-haiku-4.5",
  };
}

function openRouterFailure(status: number): string {
  if (status === 401 || status === 403) return "The OpenRouter key was rejected. Check it in Settings.";
  if (status === 402) return "The OpenRouter key has no credits left.";
  if (status === 429) return "OpenRouter rate-limited this key. Wait a minute and retry.";
  if (status >= 500) return "OpenRouter or its model provider is unavailable right now. Please retry shortly.";
  return `OpenRouter request failed (${status}).`;
}

type ChatChunk = { choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>; usage?: { cost?: number }; error?: { message?: string } };

export function openRouterRuntime(apiKey: string, opts: { siteUrl: string; models?: { teacher: string; grader: string }; fetchImpl?: typeof fetch }): TeacherRuntime {
  const models = opts.models ?? openRouterModels();
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    provider: "openrouter-key",
    send: (messages, sendOpts) => eventStream([sendOpts.system, ...messages.map((m) => m.content)], sendOpts.signal, async (emit, signal) => {
      const response = await doFetch(OPENROUTER_URL, {
        method: "POST", signal, redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          // App attribution (https://openrouter.ai/docs/app-attribution).
          "HTTP-Referer": opts.siteUrl,
          "X-OpenRouter-Title": "opensrcer",
        },
        body: JSON.stringify({
          model: models[sendOpts.tier], stream: true, max_tokens: sendOpts.maxTokens,
          messages: [{ role: "system", content: sendOpts.system }, ...messages],
          usage: { include: true },
        }),
      });
      if (!response.ok) throw new Error(openRouterFailure(response.status));
      let cost = 0;
      let finish: string | null | undefined;
      for await (const chunk of sseEvents<ChatChunk>(response)) {
        if (chunk.error) throw new Error(`OpenRouter: ${String(chunk.error.message ?? "the provider failed").slice(0, 200)}`);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) emit(choice.delta.content);
        finish = choice?.finish_reason ?? finish;
        if (typeof chunk.usage?.cost === "number" && Number.isFinite(chunk.usage.cost)) cost = chunk.usage.cost;
      }
      if (finish === "length") throw new Error("The answer reached its length limit before finishing. Try a narrower request.");
      if (finish !== "stop") throw new Error("The provider stream ended before completion. Please retry.");
      return cost;
    }),
  };
}

// ── GitHub Copilot SDK ─────────────────────────────────────────────────────

/** The slice of @github/copilot-sdk this adapter uses, from its README
 *  (CopilotClient, createSession, `assistant.message_delta`, `session.idle`). */
type CopilotSession = {
  on(event: string, handler: (event: { data?: { deltaContent?: string; message?: string } }) => void): void;
  send(options: { prompt: string }): Promise<string>;
  disconnect(): Promise<void>;
};
type CopilotClientLike = { start(): Promise<void>; createSession(config: Record<string, unknown>): Promise<CopilotSession>; stop(): Promise<unknown> };
type CopilotSdk = { CopilotClient: new (options: Record<string, unknown>) => CopilotClientLike };

export function copilotEnabled(env: Env = process.env): boolean {
  return env.OPENSRCER_COPILOT_TEACHER === "1";
}

/** Model ids per tier; knobs: OPENSRCER_COPILOT_TEACHER_MODEL / _GRADER_MODEL. */
export function copilotModels(env: Env = process.env): { teacher: string; grader: string } {
  return { teacher: env.OPENSRCER_COPILOT_TEACHER_MODEL || "claude-sonnet-5", grader: env.OPENSRCER_COPILOT_GRADER_MODEL || "gpt-5-mini" };
}

/** Loaded at runtime, never bundled: the SDK drives the Copilot CLI over
 *  JSON-RPC and needs that runtime present (not true on Vercel functions
 *  today). Replaceable in tests. */
async function loadCopilotSdk(): Promise<CopilotSdk> {
  const name = "@github/copilot-sdk";
  return (await import(/* webpackIgnore: true */ name)) as CopilotSdk;
}

/** The user's Copilot plan pays (their GitHub OAuth token, per-user billing).
 *  One short session per call: the lesson's history is sent each time, like
 *  the other adapters, so nothing lives between requests. Every tool call
 *  the CLI runtime asks for is rejected: the teacher only talks.
 *  ponytail: untested end to end here (no Copilot CLI runtime on this box);
 *  spike S8 measures it. Off unless OPENSRCER_COPILOT_TEACHER=1. */
export function copilotRuntime(gitHubToken: string, opts: { models?: { teacher: string; grader: string }; loadSdk?: () => Promise<CopilotSdk> } = {}): TeacherRuntime {
  const models = opts.models ?? copilotModels();
  const loadSdk = opts.loadSdk ?? loadCopilotSdk;
  return {
    provider: "copilot",
    send: (messages, sendOpts) => eventStream([sendOpts.system, ...messages.map((m) => m.content)], sendOpts.signal, async (emit, signal) => {
      const { CopilotClient } = await loadSdk();
      const client = new CopilotClient({ gitHubToken, useLoggedInUser: false });
      try {
        await client.start();
        const session = await client.createSession({
          model: models[sendOpts.tier],
          streaming: true,
          systemMessage: { mode: "replace", content: sendOpts.system },
          infiniteSessions: { enabled: false },
          onPermissionRequest: () => ({ kind: "reject", feedback: "Tools are not available to the teacher." }),
        });
        try {
          const idle = new Promise<void>((resolve, reject) => {
            session.on("assistant.message_delta", (event) => { if (event.data?.deltaContent) emit(event.data.deltaContent); });
            session.on("session.idle", () => resolve());
            session.on("session.error", (event) => reject(new Error(`Copilot: ${String(event.data?.message ?? "the session failed").slice(0, 200)}`)));
            signal.addEventListener("abort", () => reject(new Error("Request timed out. Please retry.")), { once: true });
          });
          // The SDK takes one prompt; earlier turns go in as a transcript.
          const history = messages.slice(0, -1).map((m) => `${m.role === "user" ? "Contributor" : "Teacher"}: ${m.content}`).join("\n\n");
          const last = messages.at(-1)?.content ?? "";
          await session.send({ prompt: history ? `<earlier-turns>\n${history}\n</earlier-turns>\n\n${last}` : last });
          await idle;
        } finally {
          await session.disconnect().catch(() => {});
        }
      } finally {
        await client.stop().catch(() => {});
      }
      return 0; // Billed to the user's Copilot plan as premium requests, not in dollars here.
    }),
  };
}

// ── Choosing one ───────────────────────────────────────────────────────────

export type RuntimeCredentials = { gitHubToken: string | null; anthropicKey: string | null; openRouterKey: string | null };

/** The first provider in `order` the user can use. The order comes from
 *  lib/run-payment.ts teacherProviders (the user's own order, which never
 *  holds a Claude or ChatGPT plan; anything else in it is skipped). Copilot
 *  counts only when enabled. Null: the teacher is unavailable (TEACHER_UNAVAILABLE). */
export function chooseRuntime(creds: RuntimeCredentials, opts: { siteUrl: string; env?: Env; order?: readonly string[] }): TeacherRuntime | null {
  const env = opts.env ?? process.env;
  for (const provider of opts.order ?? ["copilot", "anthropic-key", "openrouter-key"]) {
    if (provider === "copilot" && copilotEnabled(env) && creds.gitHubToken) return copilotRuntime(creds.gitHubToken, { models: copilotModels(env) });
    if (provider === "anthropic-key" && creds.anthropicKey) return anthropicRuntime(creds.anthropicKey, anthropicModels(env));
    if (provider === "openrouter-key" && creds.openRouterKey) return openRouterRuntime(creds.openRouterKey, { siteUrl: opts.siteUrl, models: openRouterModels(env) });
  }
  return null;
}
