import { test } from "node:test";
import assert from "node:assert/strict";
import processes from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, mkdtemp, rm, access } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

test("graph parsing removes tracked links and writes only to fresh generated output", async () => {
  const outside = await mkdtemp(join(tmpdir(), "opensrcer-graph-boundary-"));
  await writeFile(join(outside, "sentinel"), "unchanged");
  let source = "", parserCalls = 0;
  const originalExec = processes.execFile;
  const fakeExec = (() => { throw new Error("Use the promise API"); }) as unknown as typeof processes.execFile;
  Object.defineProperty(fakeExec, promisify.custom, { value: async (_cmd: string, args: string[], options: processes.ExecFileOptions) => {
    const run = async () => {
      if (args.includes("clone")) {
        source = args.at(-1)!;
        await mkdir(join(source, "graphify-out"), { recursive: true });
        await writeFile(join(source, "graphify-out", "graph.json"), "untrusted cache");
        // Windows Git can check out symlinks as text; either form must be excluded.
        await writeFile(join(source, "linked.py"), join(outside, "sentinel"));
        return "";
      }
      if (args.includes("rev-parse")) return "a".repeat(40);
      if (args.includes("ls-files")) return `120000 ${"b".repeat(40)} 0\tlinked.py\0`;
      parserCalls++;
      await assert.rejects(access(join(source, "linked.py")));
      assert.equal(options.env?.GITHUB_TOKEN, undefined);
      assert.equal(options.env?.AUTH0_SECRET, undefined);
      const output = options.env!.GRAPHIFY_OUT!;
      assert.equal(dirname(output), dirname(source));
      assert.notEqual(output, source);
      await assert.rejects(access(output), "output must start fresh");
      await mkdir(output);
      await writeFile(join(output, "graph.json"), JSON.stringify({ nodes: [], links: [] }));
      await writeFile(join(output, "graph.html"), "<p>Generated graph</p>");
      return "";
    };
    return { stdout: await run(), stderr: "" };
  } });
  processes.execFile = fakeExec;
  try {
    const { buildGraphWorker } = await import("../graph-worker");
    const result = await buildGraphWorker("acme/app", "test-user-token");
    assert.equal(parserCalls, 1);
    assert.equal(result.html, "<p>Generated graph</p>");
    assert.deepEqual(result.graph, { nodes: [], links: [] });
    assert.equal(await readFile(join(outside, "sentinel"), "utf8"), "unchanged");
    await assert.rejects(access(source), "worker cleans its disposable checkout");
  } finally {
    processes.execFile = originalExec;
    assert.equal(dirname(resolve(outside)), resolve(tmpdir()));
    assert.ok(basename(outside).startsWith("opensrcer-graph-boundary-"));
    await rm(outside, { recursive: true, force: true });
  }
});
