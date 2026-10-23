// Which credential pays for an agent run, end to end through the dispatcher
// with a mocked CLI. Its own file: agentic-dispatcher fixes its .mcp.json and
// .dispatches paths from the cwd at first import, once per test process.
import { test } from "node:test";
import assert from "node:assert/strict";
import processes from "node:child_process";
import { PassThrough } from "node:stream";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

test("a subscription run never bills a key unless the user opted in, and never silently", async (t) => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-lifecycle-"));
  process.chdir(root);
  try {
    writeFileSync(".mcp.json", "{}");
    const workers: Array<{ args: string[]; env: NodeJS.ProcessEnv; child: processes.ChildProcess; stdout: PassThrough }> = [];
    t.mock.method(processes, "spawn", (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), killed: false }) as unknown as processes.ChildProcess;
      workers.push({ args, env: options.env, child, stdout });
      return child;
    });
    const { startFindingDispatch } = await import("../agentic-dispatcher");
    const finish = async (worker: (typeof workers)[number], events: object[], code: number) => {
      worker.stdout.end(events.map((e) => JSON.stringify(e)).join("\n"));
      await once(worker.stdout, "end");
      worker.child.emit("close", code, null);
    };
    // The log is a write stream; wait for a line instead of racing its flush.
    const logHas = async (id: string, pattern: RegExp) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (pattern.test(readFileSync(join(".dispatches", `${id}.log`), "utf8"))) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.fail(`log never matched ${pattern}`);
    };
    // The final status lands after the publish-gate step, asynchronously.
    const settled = async (dispatch: { status: string }) => {
      for (let attempt = 0; attempt < 800 && dispatch.status === "running"; attempt++) await new Promise((r) => setTimeout(r, 5));
      return dispatch.status;
    };
    const init = (apiKeySource: string) => ({ type: "system", subtype: "init", apiKeySource });
    const limit = { type: "result", is_error: true, subtype: "success", result: "Claude AI usage limit reached|1700000000" };
    const ok = { type: "result", subtype: "success", stop_reason: "end_turn", is_error: false };
    const toolUse = { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__opensrcer-repo-tools__read_file", input: { repo: "acme/app", path: "package.json" } }] } };
    const opts = { auth0UserId: "test-owner", token: "test-user-token", dryRun: true, provider: "claude-subscription" as const, anthropicKey: "test-provider-value" };

    for (const keyFallback of [false, true]) {
      const before = workers.length;
      const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory" }, { ...opts, keyFallback });
      const first = workers[before];
      assert.ok(!first.args.includes("--bare"));
      assert.equal(first.env.ANTHROPIC_API_KEY, undefined, "the key is not in a subscription run's environment");
      assert.ok(first.args.includes("--max-turns"));
      await finish(first, [init("none"), limit], 1);
      await logHas(dispatch.id, /paid by: Claude subscription/);
      await logHas(dispatch.id, /credential source reported by the CLI: none/);
      if (!keyFallback) {
        assert.equal(workers.length, before + 1, "no fallback without the opt-in");
        assert.equal(await settled(dispatch), "failed");
        await logHas(dispatch.id, /could not serve this run/);
        continue;
      }
      const second = workers[before + 1];
      assert.ok(second, "opted-in fallback reruns the task");
      assert.ok(second.args.includes("--bare"));
      assert.equal(second.env.ANTHROPIC_API_KEY, "test-provider-value");
      await logHas(dispatch.id, /retrying on your Anthropic API key/);
      await finish(second, [init("ANTHROPIC_API_KEY"), toolUse, ok], 0);
      assert.equal(await settled(dispatch), "succeeded");
      await logHas(dispatch.id, /paid by: Anthropic API key/);
    }

    // An unfunded key: a named error, no retry on any other credential, not succeeded.
    {
      const before = workers.length;
      const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory" }, { ...opts, provider: "anthropic-key", keyFallback: true });
      await finish(workers[before], [init("ANTHROPIC_API_KEY"), { type: "result", is_error: true, subtype: "success", result: "Credit balance is too low to access the Anthropic API." }], 1);
      assert.equal(workers.length, before + 1, "never retried on another credential");
      assert.equal(await settled(dispatch), "failed");
      await logHas(dispatch.id, /Your Anthropic API key has no credit\. Add credit or use a subscription\./);
    }

    // Repository tools that never connected: prose about tool calls is not a result.
    {
      const before = workers.length;
      const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory" }, opts);
      // OPENSRCER_MCP_CONNECT_TIMEOUT_MS, default 5 min (lib/limits.ts).
      assert.equal(workers[before].env.MCP_TIMEOUT, "300000");
      assert.equal(workers[before].env.MCP_CONNECT_TIMEOUT_MS, "300000");
      assert.equal(workers[before].env.MCP_CONNECTION_NONBLOCKING, "0");
      await finish(workers[before], [{ ...init("none"), tools: [], mcp_servers: [{ name: "opensrcer-repo-tools", status: "failed" }] }, ok], 0);
      assert.equal(await settled(dispatch), "failed");
      await logHas(dispatch.id, /mcp: opensrcer-repo-tools=failed tools=0/);
      await logHas(dispatch.id, /made no repository tool calls \(tools were failed at start\)/);
    }

    // The CLI says it used a key in a subscription run: stopped, never billed quietly.
    const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory" }, { ...opts, keyFallback: true });
    await finish(workers.at(-1)!, [init("ANTHROPIC_API_KEY"), toolUse, ok], 0);
    assert.equal(await settled(dispatch), "failed");
    await logHas(dispatch.id, /picked up an API key or token; stopping it/);
  } finally {
    process.chdir(original);
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("opensrcer-lifecycle-"));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});
