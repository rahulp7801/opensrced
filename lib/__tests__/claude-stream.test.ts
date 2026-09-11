import { test } from "node:test";
import assert from "node:assert/strict";
import processes from "node:child_process";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { localClaudeStream } from "../claude-stream";

test("local exploration never turns failed or truncated output into a done event", async (t) => {
  for (const result of [null, { type: "result", is_error: true }, { type: "result", subtype: "success", is_error: false }]) {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough() }) as unknown as processes.ChildProcess;
    t.mock.method(processes, "spawn", () => child);
    let releases = 0;
    const response = localClaudeStream([], { NODE_ENV: "test" }, new AbortController().signal, () => { releases++; });
    stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Some output" }] } }) + "\n");
    if (result) stdout.write(JSON.stringify(result));
    child.emit("close", 0);
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.some(event => event.done), result?.is_error === false);
    assert.equal(events.some(event => event.error), result?.is_error !== false);
    assert.equal(releases, 1);
    stdout.end();
    child.stderr!.destroy();
  }
});
