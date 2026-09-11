import { test } from "node:test";
import assert from "node:assert/strict";
import processes from "node:child_process";
import { PassThrough } from "node:stream";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

test("only completed agent output reaches the PR hook and persists a successful dispatch", async (t) => {
  const original = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "opensrcer-lifecycle-"));
  const autoPr = process.env.OPENSRCER_AGENTIC_AUTO_PR;
  process.env.OPENSRCER_AGENTIC_AUTO_PR = "1";
  process.chdir(root);
  try {
    writeFileSync(".mcp.json", "{}");
    const workers: Array<{ child: processes.ChildProcess; stdout: PassThrough }> = [];
    t.mock.method(processes, "spawn", (_command: string, args: string[]) => {
      assert.equal(args[args.indexOf("--tools") + 1], "");
      assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
      assert.ok(args.includes("--bare"));
      assert.ok(!args.includes("bypassPermissions"));
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), killed: false }) as unknown as processes.ChildProcess;
      workers.push({ child, stdout });
      return child;
    });
    const prs = await import("../agentic-pr");
    let publications = 0;
    let published!: () => void;
    const publication = new Promise<void>(resolve => { published = resolve; });
    t.mock.method(prs, "createDraftPrFromLog", async () => {
      publications++;
      published();
      return { ok: false, reason: "Test hook; no external writes", tests: "not_run" };
    });
    const { startFindingDispatch } = await import("../agentic-dispatcher");
    let lastId = "";
    for (const result of [null, { type: "result", is_error: true }, { type: "result", subtype: "success", is_error: false }]) {
      const dispatch = await startFindingDispatch("acme/app", { id: "test-finding", kind: "advisory", summary: "Test only" }, { auth0UserId: "test-owner", token: "test-user-token", anthropicKey: "test-provider-value" });
      lastId = dispatch.id;
      const worker = workers.at(-1)!;
      worker.stdout.end(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Partial patch" }] } }) + "\n" + (result ? JSON.stringify(result) : ""));
      await once(worker.stdout, "end");
      worker.child.emit("close", 0, null);
      const record = JSON.parse(readFileSync(join(".dispatches", `${dispatch.id}.json`), "utf8"));
      const successful = result?.is_error === false;
      assert.equal(dispatch.status, successful ? "succeeded" : "failed");
      assert.equal(record.pr_status, successful ? "pending" : "none");
      assert.equal(publications, 0, "failed and truncated outputs cannot publish");
    }
    await publication;
    assert.equal(publications, 1);
    const recordPath = join(".dispatches", `${lastId}.json`);
    for (let attempt = 0; attempt < 200; attempt++) {
      if (JSON.parse(readFileSync(recordPath, "utf8")).pr_status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(JSON.parse(readFileSync(recordPath, "utf8")).pr_status, "failed", "the mocked PR hook must finish before cleanup");
  } finally {
    process.chdir(original);
    if (autoPr === undefined) delete process.env.OPENSRCER_AGENTIC_AUTO_PR;
    else process.env.OPENSRCER_AGENTIC_AUTO_PR = autoPr;
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("opensrcer-lifecycle-"));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
});
