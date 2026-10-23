import { test } from "node:test";
import assert from "node:assert/strict";
import { agenticChildEnv, fetchIssue, findOpenRunPr, pipeStreamJson, RunTargetError } from "../agentic-dispatcher";
import { PassThrough } from "node:stream";
import { once } from "node:events";

test("agentic subprocess receives only its own provider credential", () => {
  const env = agenticChildEnv("acme/app", {
    token: "github-token",
    anthropicKey: "anthropic-key",
    geminiKey: "gemini-review-key",
  });

  assert.equal(env.OPENSRCER_ALLOWED_REPO, "acme/app");
  assert.equal(env.GITHUB_TOKEN, "github-token");
  assert.equal(env.ANTHROPIC_API_KEY, "anthropic-key");
  assert.equal(env.GEMINI_API_KEY, undefined);
});

test("dispatches authorize the issue before reading cached source or starting a model", async (t) => {
  let status = 404;
  let pull = false;
  let state = "open";
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.github.com/repos/acme/app/issues/1");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-user-token");
    return Response.json(status === 200 ? { ...(pull ? { pull_request: {} } : {}), state, title: "Fix typo", body: "Correct README", labels: [{ name: "docs" }], html_url: "https://github.com/acme/app/issues/1" } : {}, { status });
  });
  // Run-target failures are user-facing (routes answer 400, not 503).
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), (error: Error) =>
    error instanceof RunTargetError && error.message === "GitHub repository was not found or is not accessible.");
  status = 403;
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), {
    message: "GitHub denied this request or its rate limit was reached. Try again later.",
  });
  status = 200;
  pull = true;
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), (error: Error) =>
    error instanceof RunTargetError && /pull request, not an issue/.test(error.message));
  pull = false;
  state = "closed";
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), (error: Error) =>
    error instanceof RunTargetError && /issue is closed/.test(error.message));
  state = "open";
  const issue = await fetchIssue("acme/app", 1, "test-user-token");
  assert.equal(issue.title, "Fix typo");
  assert.match(issue.formatted, /untrusted="true"/);
  assert.equal(issue.formatted.split("\n")[9], "URL: https://github.com/acme/app/issues/1");
});

test("dispatch completion requires a successful result and preserves split UTF-8 text", async () => {
  async function parse(events: unknown[]) {
    const input = new PassThrough(), output = new PassThrough();
    let log = "";
    output.on("data", chunk => { log += chunk.toString(); });
    const state = pipeStreamJson(input, output);
    const payload = Buffer.from(events.map(event => JSON.stringify(event)).join("\n"));
    // Bytewise input also splits multibyte characters and the final result has no newline.
    for (const byte of payload) input.write(Buffer.from([byte]));
    input.end();
    await once(input, "end");
    output.end();
    return { ...state, log };
  }
  const text = { type: "assistant", message: { content: [{ type: "text", text: "caf\u00e9" }] } };
  // A success needs at least one real repository tool call.
  const read = { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__opensrcer-repo-tools__read_file", input: { path: "a.ts" } }] } };
  const success = await parse([read, text, { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01 }]);
  assert.equal((await parse([text, { type: "result", subtype: "success", is_error: false }])).failed, true, "no tool call, no result");
  assert.equal(success.complete, true);
  assert.equal(success.failed, false);
  assert.match(success.log, /caf\u00e9/);
  assert.equal((await parse([text])).complete, false);
  const failure = await parse([text, { type: "result", subtype: "error_max_budget_usd", is_error: true }]);
  assert.equal(failure.complete, false);
  assert.equal(failure.failed, true);

  // Tool calls become one sanitized line each, with no tool output.
  const tool = { type: "assistant", message: { content: [
    { type: "tool_use", name: "mcp__opensrcer-repo-tools__read_file", input: { repo: "o/r", path: "src/a.ts\n[agentic-pr] fake", limit: 5 } },
  ] } };
  const withTool = await parse([text, tool, text]);
  assert.match(withTool.log, /^café\n\[tool\] read_file src\/a\.ts \[agentic-pr\] fake\ncafé$/);
});

test("a live run finds the caller's own open PR for the same issue, and only that", async (t) => {
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://api.github.com/repos/acme/app/pulls?state=open&per_page=100");
    return Response.json(status === 200 ? [
      { html_url: "https://github.com/acme/app/pull/12", head: { ref: "opensrcer/issue-12-abc", user: { login: "Alice" } } },
      { html_url: "https://github.com/acme/app/pull/7", head: { ref: "opensrcer/issue-1-def", user: { login: "bob" } } },
      { html_url: "https://github.com/acme/app/pull/8", head: { ref: "fix/issue-1", user: { login: "alice" } } },
      { html_url: "https://github.com/acme/app/pull/9", head: { ref: "opensrcer/issue-1-ghi", user: null } },
    ] : {}, { status });
  });
  assert.equal(await findOpenRunPr("acme/app", 12, "alice", "t"), "https://github.com/acme/app/pull/12");
  // issue-1 must not match issue-12, another user's run, or a hand-made branch.
  assert.equal(await findOpenRunPr("acme/app", 1, "alice", "t"), null);
  status = 403;
  await assert.rejects(findOpenRunPr("acme/app", 1, "alice", "t"), (error: Error) => error instanceof RunTargetError);
});
