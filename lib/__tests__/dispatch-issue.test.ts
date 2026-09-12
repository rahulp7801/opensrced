import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchIssue, pipeStreamJson } from "../agentic-dispatcher";
import { PassThrough } from "node:stream";
import { once } from "node:events";

test("dispatches authorize the issue before reading cached source or starting a model", async (t) => {
  let status = 404;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.github.com/repos/acme/app/issues/1");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-user-token");
    return Response.json(status === 200 ? { title: "Fix typo", body: "Correct README", labels: [{ name: "docs" }], html_url: "https://github.com/acme/app/issues/1" } : {}, { status });
  });
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), {
    message: "GitHub repository was not found or is not accessible.",
  });
  status = 403;
  await assert.rejects(fetchIssue("acme/app", 1, "test-user-token"), {
    message: "GitHub denied this request or its rate limit was reached. Try again later.",
  });
  status = 200;
  const issue = await fetchIssue("acme/app", 1, "test-user-token");
  assert.equal(issue.title, "Fix typo");
  assert.match(issue.formatted, /untrusted="true"/);
  assert.match(issue.formatted, /https:\/\/github.com\/acme\/app\/issues\/1/);
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
  const success = await parse([text, { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01 }]);
  assert.equal(success.complete, true);
  assert.equal(success.failed, false);
  assert.match(success.log, /caf\u00e9/);
  assert.equal((await parse([text])).complete, false);
  const failure = await parse([text, { type: "result", subtype: "error_max_budget_usd", is_error: true }]);
  assert.equal(failure.complete, false);
  assert.equal(failure.failed, true);
});
