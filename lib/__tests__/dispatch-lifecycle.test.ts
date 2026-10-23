import { test } from "node:test";
import assert from "node:assert/strict";
import processes from "node:child_process";
import { PassThrough } from "node:stream";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const DIFF = "```diff\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-{\"a\":1}\n+{\"a\":2}\n```";

test("only completed agent output that used its tools becomes a preview; nothing is auto-published", async (t) => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-lifecycle-"));
  process.chdir(root);
  try {
    writeFileSync(".mcp.json", JSON.stringify({ mcpServers: { "opensrcer-repo-tools": { command: "node", args: ["./mcp-server/dist/server.js"] } } }));
    const workers: Array<{ child: processes.ChildProcess; stdout: PassThrough; cwd?: string; config: string }> = [];
    t.mock.method(processes, "spawn", (_command: string, args: string[], opts: { cwd?: string }) => {
      assert.equal(args[args.indexOf("--tools") + 1], "");
      assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
      assert.ok(args.includes("--bare"));
      assert.ok(!args.includes("bypassPermissions"));
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), killed: false }) as unknown as processes.ChildProcess;
      workers.push({ child, stdout, cwd: opts.cwd, config: args[args.indexOf("--mcp-config") + 1] });
      return child;
    });
    const prs = await import("../agentic-pr");
    let publications = 0;
    t.mock.method(prs, "createDraftPrFromLog", async () => {
      publications++;
      return { ok: false, reason: "Test hook; no external writes", tests: "not_run" };
    });
    const { startFindingDispatch } = await import("../agentic-dispatcher");
    const toolUse = { type: "tool_use", name: "mcp__opensrcer-repo-tools__read_file", input: { repo: "acme/app", path: "package.json" } };
    const cases: Array<{ result: object | null; tools: boolean; ok: boolean }> = [
      { result: null, tools: true, ok: false },
      { result: { type: "result", is_error: true }, tools: true, ok: false },
      { result: { type: "result", subtype: "success", stop_reason: "max_tokens", is_error: false }, tools: true, ok: false },
      // A model without its tools can only imagine tool calls: never a success.
      { result: { type: "result", subtype: "success", stop_reason: "end_turn", is_error: false }, tools: false, ok: false },
      { result: { type: "result", subtype: "success", stop_reason: "end_turn", is_error: false }, tools: true, ok: true },
    ];
    for (const c of cases) {
      const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory", summary: "Test only" }, { auth0UserId: "test-owner", token: "test-user-token", anthropicKey: "test-provider-value" });
      const worker = workers.at(-1)!;
      // The agent runs from an empty per-run directory with an absolute MCP config.
      assert.equal(worker.cwd, join(root, ".dispatches", dispatch.id, "work"));
      assert.match(readFileSync(worker.config, "utf8"), /mcp-server[\\/]+dist[\\/]+server\.js/);
      const content = [...(c.tools ? [toolUse] : []), { type: "text", text: `## PR title\nfix: bump a\n\n${DIFF}\n` }];
      worker.stdout.end(JSON.stringify({ type: "assistant", message: { content } }) + "\n" + (c.result ? JSON.stringify(c.result) : ""));
      await once(worker.stdout, "end");
      worker.child.emit("close", 0, null);
      const recordPath = join(".dispatches", `${dispatch.id}.json`);
      // The record is written at start (running) and again once the run is finalized.
      for (let attempt = 0; attempt < 800 && (!existsSync(recordPath) || JSON.parse(readFileSync(recordPath, "utf8")).status === "running"); attempt++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      assert.equal(record.status, c.ok ? "succeeded" : "failed");
      assert.equal(record.pr_status, c.ok ? "awaiting_review" : "none");
      assert.equal(Boolean(record.has_preview), c.ok);
      assert.equal(existsSync(join(".dispatches", dispatch.id, "preview.json")), c.ok);
    }
    assert.equal(publications, 0, "a finished run never publishes on its own; only the publish gate does");
  } finally {
    process.chdir(original);
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("opensrcer-lifecycle-"));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});
