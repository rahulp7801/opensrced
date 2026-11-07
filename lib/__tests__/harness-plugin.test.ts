// The plugin's MCP server (harness/server.mjs), run for real over stdio
// against a stub opensrcer.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";

const TOKEN = `osh_${"t".repeat(32)}`;
const seen: Array<{ method: string; url: string; auth: string; body: string }> = [];
let stub: Server;
let base = "";

before(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization ?? "", body });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "This harness token is not valid." })); }
      if (req.url === "/api/harness/check") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ repo: "Acme/App", checks: [
          { id: "tests", status: "warn", text: "90% of merged outside PRs here change tests; this draft changes none.", examples: ["https://github.com/acme/app/pull/3"] },
          { id: "linked-issue", status: "ok", text: "The description links an issue, like most merged PRs here.", examples: [] },
        ] }));
      }
      if (req.url?.startsWith("/api/harness/profile")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          profile: { repo: "Acme/App", window: { prs: 90, from: "2026-07-01T00:00:00Z", to: "2026-10-01T00:00:00Z" } },
          findings: [
            { section: "closed", text: "23 of 32 closed outside PRs: opened without being assigned to the issue first.", examples: ["https://github.com/acme/app/pull/9"] },
            { section: "conventions", text: "Changelog entries go in HISTORY.md.", examples: [] },
          ],
          page: "https://opensrced.example/repos/Acme/App",
          advice: { reason: "not_assigned", count: 23, of: 32, comment: "Hi! I'd like to work on this. Could you assign it to me?", headline: "23 of 32 recently closed outside PRs here were opened without being assigned to the issue. Ask to be assigned first, and wait for a yes." },
        }));
      }
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
after(() => stub.close());

/** A running server and a request function speaking JSON-RPC over its stdio. */
function start(token: string) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [join(process.cwd(), "harness", "server.mjs")], {
    env: { ...process.env, OPENSRCER_URL: base, OPENSRCER_TOKEN: token },
  });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as { id: number };
    pending.get(message.id)?.(message);
  });
  let next = 0;
  const request = (method: string, params?: unknown) => new Promise<Record<string, unknown>>((resolve) => {
    const id = ++next;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  return { child, request, notify: (method: string) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n") };
}

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };
const text = (r: Record<string, unknown>) => (r.result as ToolResult).content[0].text;

test("the plugin server speaks MCP: initialize, tools, and calls that reach opensrcer with the token", async () => {
  const { child, request, notify } = start(TOKEN);
  try {
    const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.deepEqual((init.result as { serverInfo: unknown }).serverInfo, { name: "opensrcer", version: "0.1.0" });
    // Hosts without the plugin's skill get the workflow from the server itself.
    assert.match((init.result as { instructions: string }).instructions, /Call repo_profile .* before changing code/);
    notify("notifications/initialized");
    const tools = (await request("tools/list")).result as { tools: Array<{ name: string }> };
    assert.deepEqual(tools.tools.map((t) => t.name), ["repo_profile", "check_pr", "record_event"]);

    const check = await request("tools/call", { name: "check_pr", arguments: {
      repo: "acme/app", title: "Add fill", body: "Fixes #12", files: ["src/fill.py"], additions: 40, deletions: 2, linked_issue: true, signed_off: false } });
    assert.match(text(check), /^# Acme\/App: the draft against how this project merges PRs/);
    assert.ok(text(check).includes("- WARN: 90% of merged outside PRs here change tests; this draft changes none. (e.g. https://github.com/acme/app/pull/3)"));
    assert.ok(text(check).endsWith("1 warning: fix them, or tell the user why not, before opening the PR."));
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), { repo: "acme/app", draft: {
      title: "Add fill", body: "Fixes #12", files: ["src/fill.py"], additions: 40, deletions: 2, linkedIssue: true, signedOff: false } });

    const profile = await request("tools/call", { name: "repo_profile", arguments: { repo: "acme/app" } });
    assert.equal((profile.result as ToolResult).isError, undefined);
    assert.match(text(profile), /^# Acme\/App: how this project reviews contributions/);
    assert.match(text(profile), /## Why PRs get closed\n- 23 of 32 closed outside PRs: opened without being assigned to the issue first\. \(e\.g\. https:\/\/github\.com\/acme\/app\/pull\/9\)/);
    assert.match(text(profile), /Full page: https:\/\/opensrced\.example\/repos\/Acme\/App$/);
    assert.ok(text(profile).includes(["## Before writing code", "23 of 32 recently closed outside PRs here were opened without being assigned to the issue."].join("\n")));
    assert.ok(text(profile).includes(`post themselves: "Hi! I'd like to work on this. Could you assign it to me?"`));
    assert.equal(seen.at(-1)?.url, "/api/harness/profile?repo=acme%2Fapp");
    assert.equal(seen.at(-1)?.auth, `Bearer ${TOKEN}`);

    const event = await request("tools/call", { name: "record_event", arguments: { type: "pr_opened", repo: "acme/app", pr_url: "https://github.com/acme/app/pull/12" } });
    assert.equal(text(event), "Recorded pr_opened for acme/app.");
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), { type: "pr_opened", repo: "acme/app", data: { pr_url: "https://github.com/acme/app/pull/12" } });

    // A PR URL that isn't one is dropped rather than forwarded.
    await request("tools/call", { name: "record_event", arguments: { type: "pr_opened", repo: "acme/app", pr_url: "https://evil.example/x" } });
    assert.deepEqual(JSON.parse(seen.at(-1)!.body).data, {});

    const unknown = await request("nope");
    assert.equal((unknown.error as { code: number }).code, -32601);
  } finally {
    child.kill();
  }
});

const BAD_CALLS: Array<[string, Record<string, unknown>, RegExp]> = [
  ["a malformed repo", { name: "repo_profile", arguments: { repo: "../etc" } }, /owner\/name/],
  ["an unknown event type", { name: "record_event", arguments: { type: "deleted", repo: "acme/app" } }, /type must be one of/],
  ["an unknown tool", { name: "rm_rf", arguments: { repo: "acme/app" } }, /Unknown tool/],
];
for (const [name, params, message] of BAD_CALLS) {
  test(`the plugin server answers ${name} with a tool error, sending nothing`, async () => {
    const { child, request } = start(TOKEN);
    try {
      const before = seen.length;
      const r = await request("tools/call", params);
      assert.equal((r.result as ToolResult).isError, true);
      assert.match(text(r), message);
      assert.equal(seen.length, before);
    } finally {
      child.kill();
    }
  });
}

test("without a token the tools say how to get one; with a bad one, opensrcer's answer is passed on", async () => {
  const none = start("");
  try {
    const r = await none.request("tools/call", { name: "repo_profile", arguments: { repo: "acme/app" } });
    assert.equal((r.result as ToolResult).isError, true);
    assert.match(text(r), /Create one at .*\/account \(Harness\)/);
  } finally {
    none.child.kill();
  }
  const bad = start(`osh_${"x".repeat(32)}`);
  try {
    const r = await bad.request("tools/call", { name: "repo_profile", arguments: { repo: "acme/app" } });
    assert.equal(text(r), "This harness token is not valid.");
  } finally {
    bad.child.kill();
  }
});
