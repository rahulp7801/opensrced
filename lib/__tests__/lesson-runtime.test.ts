import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicModels, anthropicRuntime, chooseRuntime, complete, copilotRuntime, OPENROUTER_URL, openRouterRuntime, TEACHER_UNAVAILABLE } from "../lesson/runtime";

const signal = () => new AbortController().signal;
const sseBody = (events: Array<object | string>) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
const opts = (tier: "teacher" | "grader" = "teacher") => ({ system: "You teach.", tier, maxTokens: 300, signal: signal() });

test("anthropic adapter: teacher on the agent model with the system prompt cached; graders on the fast model, uncached", async (t) => {
  const bodies: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(sseBody([
      { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } } },
      { type: "content_block_delta", delta: { text: "What happens on a redirect?" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ]));
  });
  const rt = anthropicRuntime("sk-test");
  const reply = await complete(rt, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "help" }], opts());
  assert.equal(reply.text, "What happens on a redirect?");
  // claude-sonnet-5: (100 + 2000 * 0.1) * $2 + 20 * $10, per million.
  assert.ok(Math.abs(reply.cost - (300 * 2 + 20 * 10) / 1e6) < 1e-12, String(reply.cost));
  assert.equal(bodies[0].model, "claude-sonnet-5");
  assert.deepEqual(bodies[0].system, [{ type: "text", text: "You teach.", cache_control: { type: "ephemeral" } }]);
  assert.equal((bodies[0].messages as unknown[]).length, 3, "the history goes as turns");
  await complete(rt, [{ role: "user", content: "grade" }], opts("grader"));
  assert.equal(bodies[1].model, "claude-haiku-4-5");
  assert.equal(bodies[1].system, "You teach.");
});

test("openrouter adapter: OpenAI-compatible streaming with attribution headers and the reported cost", async (t) => {
  const seen: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(`: OPENROUTER PROCESSING\n\n${sseBody([
      { choices: [{ delta: { content: "Which " }, finish_reason: null }] },
      { choices: [{ delta: { content: "branch runs?" }, finish_reason: "stop" }] },
      { choices: [], usage: { cost: 0.0021 } },
      "[DONE]",
    ])}`);
  }) as typeof fetch;
  const rt = openRouterRuntime("or-key", { siteUrl: "https://opensrcer.example", models: { teacher: "anthropic/claude-sonnet-5", grader: "z/cheap" }, fetchImpl });
  const reply = await complete(rt, [{ role: "user", content: "help" }], opts());
  assert.deepEqual(reply, { text: "Which branch runs?", cost: 0.0021 });
  assert.equal(seen[0].url, OPENROUTER_URL);
  assert.equal(seen[0].headers.Authorization, "Bearer or-key");
  assert.equal(seen[0].headers["HTTP-Referer"], "https://opensrcer.example");
  assert.equal(seen[0].headers["X-OpenRouter-Title"], "opensrcer");
  assert.deepEqual(seen[0].body.messages, [{ role: "system", content: "You teach." }, { role: "user", content: "help" }]);
  assert.equal(seen[0].body.stream, true);
  await complete(rt, [{ role: "user", content: "g" }], opts("grader"));
  assert.equal(seen[1].body.model, "z/cheap");
  t.mock.reset();
});

test("openrouter adapter: rejected keys, truncation and mid-stream errors never complete", async () => {
  const cases: Array<[Response, RegExp]> = [
    [new Response("no", { status: 401 }), /OpenRouter key was rejected/],
    [new Response("no", { status: 402 }), /no credits/],
    [new Response(sseBody([{ choices: [{ delta: { content: "cut" }, finish_reason: "length" }] }])), /length limit/],
    [new Response(sseBody([{ choices: [{ delta: { content: "half" } }] }])), /ended before completion/],
    [new Response(sseBody([{ error: { message: "upstream exploded" } }])), /OpenRouter: upstream exploded/],
  ];
  for (const [response, message] of cases) {
    const rt = openRouterRuntime("k", { siteUrl: "https://x", models: { teacher: "m", grader: "m" }, fetchImpl: (async () => response) as typeof fetch });
    await assert.rejects(complete(rt, [{ role: "user", content: "hi" }], opts()), message);
  }
});

test("a credential in the request never leaves, whatever the adapter", async () => {
  let called = false;
  const rt = openRouterRuntime("k", { siteUrl: "https://x", models: { teacher: "m", grader: "m" }, fetchImpl: (async () => { called = true; return new Response(""); }) as typeof fetch });
  await assert.rejects(complete(rt, [{ role: "user", content: "my token is ghp_abcdefghijklmnopqrstuvwxyz0123456789" }], opts()), /sensitive|token/i);
  assert.equal(called, false);
});

test("copilot adapter: one short session, system prompt replaced, every tool request rejected", async () => {
  const log: string[] = [];
  let permission: unknown;
  let config: Record<string, unknown> = {};
  class FakeClient {
    constructor(readonly options: Record<string, unknown>) { log.push(`client ${JSON.stringify(options)}`); }
    async start() { log.push("start"); }
    async stop() { log.push("stop"); }
    async createSession(c: Record<string, unknown>) {
      config = c;
      permission = (c.onPermissionRequest as () => unknown)();
      const handlers = new Map<string, (e: { data?: { deltaContent?: string } }) => void>();
      return {
        on: (event: string, h: (e: { data?: { deltaContent?: string } }) => void) => { handlers.set(event, h); },
        send: async (o: { prompt: string }) => {
          log.push(`prompt ${o.prompt}`);
          handlers.get("assistant.message_delta")?.({ data: { deltaContent: "What do " } });
          handlers.get("assistant.message_delta")?.({ data: { deltaContent: "you see?" } });
          handlers.get("session.idle")?.({});
          return "m1";
        },
        disconnect: async () => { log.push("disconnect"); },
      };
    }
  }
  const rt = copilotRuntime("gho_user", { models: { teacher: "claude-sonnet-5", grader: "gpt-5-mini" }, loadSdk: async () => ({ CopilotClient: FakeClient }) });
  const reply = await complete(rt, [{ role: "user", content: "first" }, { role: "assistant", content: "q?" }, { role: "user", content: "second" }], opts());
  assert.equal(reply.text, "What do you see?");
  assert.match(log[0], /"gitHubToken":"gho_user","useLoggedInUser":false/);
  assert.deepEqual(config.systemMessage, { mode: "replace", content: "You teach." });
  assert.equal(config.model, "claude-sonnet-5");
  assert.deepEqual(permission, { kind: "reject", feedback: "Tools are not available to the teacher." });
  assert.match(log.find((l) => l.startsWith("prompt"))!, /<earlier-turns>\nContributor: first\n\nTeacher: q\?\n<\/earlier-turns>\n\nsecond$/);
  assert.deepEqual(log.slice(-2), ["disconnect", "stop"], "the session and the client are always closed");
});

test("copilot adapter: a missing SDK is an error event, not a crash", async () => {
  const rt = copilotRuntime("gho_user", { loadSdk: async () => { throw new Error("Cannot find module '@github/copilot-sdk'"); } });
  await assert.rejects(complete(rt, [{ role: "user", content: "hi" }], opts()), /Cannot find module/);
});

test("choosing an engine: Copilot (when enabled), then an Anthropic key, then OpenRouter; never a Claude plan", () => {
  const all = { gitHubToken: "gho", anthropicKey: "sk", openRouterKey: "or" };
  assert.equal(chooseRuntime(all, { siteUrl: "x", env: { OPENSRCER_COPILOT_TEACHER: "1" } })?.provider, "copilot");
  assert.equal(chooseRuntime(all, { siteUrl: "x", env: {} })?.provider, "anthropic-key", "Copilot is off by default");
  assert.equal(chooseRuntime({ ...all, anthropicKey: null }, { siteUrl: "x", env: {} })?.provider, "openrouter-key");
  assert.equal(chooseRuntime({ gitHubToken: "gho", anthropicKey: null, openRouterKey: null }, { siteUrl: "x", env: {} }), null);
  assert.deepEqual(anthropicModels({}), { teacher: "claude-sonnet-5", grader: "claude-haiku-4-5" });
  assert.deepEqual(anthropicModels({ OPENSRCER_ANTHROPIC_TEACHER_MODEL: "claude-haiku-4-5" }).teacher, "claude-haiku-4-5", "a knob for cheaper teaching");
  // The user's order (teacherProviders) wins; a Claude plan in it is skipped, never used.
  assert.equal(chooseRuntime(all, { siteUrl: "x", env: {}, order: ["claude-subscription", "openrouter-key", "anthropic-key"] })?.provider, "openrouter-key");
  assert.equal(chooseRuntime(all, { siteUrl: "x", env: {}, order: ["claude-subscription"] }), null);
  assert.match(TEACHER_UNAVAILABLE, /Copilot or your own API key/);
});
