// The plugin's MCP server (harness/server.mjs), run for real over stdio
// against a stub opensrcer.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const TOKEN = `osh_${"t".repeat(32)}`;
const home = mkdtempSync(join(tmpdir(), "opensrcer-home-"));
const seen: Array<{ method: string; url: string; auth: string; body: string }> = [];
let stub: Server;
let base = "";

before(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization ?? "", body });
      // /repos/… stands in for GitHub's API, which never sees the opensrcer token.
      if (!req.url?.startsWith("/repos/") && req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "This harness token is not valid." })); }
      if (req.url === "/api/harness/check" && JSON.parse(body).repo === "acme/quiet") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ repo: "Acme/Quiet", checks: [] }));
      }
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
      const lessonRoute = /^\/api\/harness\/lessons(?:\/(l_[0-9a-f-]+)(?:\/(\w+))?)?/.exec(req.url ?? "");
      if (req.url === "/repos/acme/app/issues/12") return reply(res, { title: "fill ignores value", body: "fill(df, 0) leaves NaN." });
      if (lessonRoute) return reply(res, lessonApi(req.method ?? "", lessonRoute[1], lessonRoute[2], body));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
after(() => stub.close());

function reply(res: import("node:http").ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// A stub of /api/harness/lessons (the real one: lib/__tests__/harness-lessons.test.ts).
const LESSON_ID = "l_0b3a5c1e-0000-4000-8000-000000000001";
const lessonBase = (stage: string, answerKey = "pending") => ({
  id: LESSON_ID, repo_url: "https://github.com/acme/app", issue_number: 12, path: "A", mode: "short", stage, answer_key: answerKey, revealed: stage === "explain",
  required: ["s1", "s4", "s7", "s8", "explain-it", "s10"],
  steps: [
    { id: "s1", title: "What the project does", question: "What does this project do?", done: stage !== "kickoff", grade: null, hint_level: -1, max_hint_level: 2, answer: "" },
    { id: "s4", title: "The task", question: "What should happen?", done: false, grade: null, hint_level: -1, max_hint_level: 2, answer: "" },
    { id: "s7", title: "Three starting points", question: "Where would you look?", done: false, grade: null, hint_level: -1, max_hint_level: 3, answer: JSON.stringify(["app/fill.py", "app/core.py"]) },
  ],
});
function lessonApi(method: string, id: string | undefined, action: string | undefined, raw: string) {
  const body = raw ? JSON.parse(raw) : {};
  if (!id) return { lesson: lessonBase("kickoff") };
  if (action === "answer") return body.grader_reply === undefined
    ? { needs_grading: true, step: body.step, rubric: { system: "Judge it. {\"users\":true}", user: "<contributor-answer>…</contributor-answer>" } }
    : { step: { id: body.step, done: true, grade: { passed: true, feedback: "Clear." } }, lesson: lessonBase("kickoff") };
  if (action === "key") return { lesson: lessonBase("kickoff", "verified") };
  if (action === "reveal") return { lesson: lessonBase("explain", "verified") };
  if (action === "hint") return { step: body.step, level: 0, text: "Who would install it?" };
  if (action === "diff") return { lesson: lessonBase("reveal", "verified") };
  if (method === "GET") return { lesson: lessonBase("explain", "verified"), key: { diff: "+++ b/app/fill.py\n", title: "Fill", diagnosis: "d" } };
  return { error: "unexpected" };
}

/** A running server and a request function speaking JSON-RPC over its stdio. */
function start(token: string) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [join(process.cwd(), "harness", "server.mjs")], {
    env: { ...process.env, OPENSRCER_URL: base, OPENSRCER_TOKEN: token, GITHUB_API_URL: base, OPENSRCER_HOME: home },
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
    assert.deepEqual((init.result as { serverInfo: unknown }).serverInfo, { name: "opensrcer", version: "0.2.0" });
    // Hosts without the plugin's skill get the workflow from the server itself.
    assert.match((init.result as { instructions: string }).instructions, /Call repo_profile .* before changing code/);
    notify("notifications/initialized");
    const tools = (await request("tools/list")).result as { tools: Array<{ name: string }> };
    assert.deepEqual(tools.tools.map((t) => t.name), ["repo_profile", "check_pr", "record_event", "lesson_start", "lesson_answer", "lesson_hint", "lesson_key", "lesson_reveal", "lesson_submit_own", "lesson_show"]);
    assert.ok(tools.tools.every((t) => !("_meta" in t)), "a host without MCP Apps gets no UI metadata");

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

test("check_pr with nothing to compare says so instead of printing a bare pass", async () => {
  const { child, request } = start(TOKEN);
  try {
    const r = await request("tools/call", { name: "check_pr", arguments: { repo: "acme/quiet", title: "Fix", body: "", files: ["a.py"], additions: 1, deletions: 0, linked_issue: false } });
    assert.ok(text(r).includes("- NOTE: Nothing here applied to this draft, so it was not compared with anything."));
    assert.ok(text(r).endsWith("No warnings."));
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

const UI_CAPS = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } };

test("a host that renders MCP Apps gets the lesson panel: UI metadata, the panel-only tools and the view", async () => {
  const { child, request } = start(TOKEN);
  try {
    const init = (await request("initialize", { protocolVersion: "2025-06-18", capabilities: UI_CAPS, clientInfo: { name: "vscode", version: "1" } })).result as { capabilities: Record<string, unknown> };
    assert.ok("resources" in init.capabilities);
    const tools = ((await request("tools/list")).result as { tools: Array<{ name: string; _meta?: { ui?: { resourceUri: string; visibility: string[] }; "ui/resourceUri"?: string } }> }).tools;
    const meta = Object.fromEntries(tools.map((t) => [t.name, t._meta]));
    assert.deepEqual(meta.lesson_start?.ui, { resourceUri: "ui://opensrcer/lesson.html", visibility: ["model", "app"] });
    assert.equal(meta.lesson_start?.["ui/resourceUri"], "ui://opensrcer/lesson.html", "the legacy key too, for older hosts");
    assert.deepEqual(meta.lesson_state?.ui?.visibility, ["app"]);
    assert.deepEqual(meta.lesson_graph?.ui?.visibility, ["app"]);
    assert.equal(meta.lesson_answer, undefined, "the model grading an answer doesn't open another panel");
    const listed = (await request("resources/list")).result as { resources: Array<{ uri: string; mimeType: string }> };
    assert.deepEqual(listed.resources.map((r) => [r.uri, r.mimeType]), [["ui://opensrcer/lesson.html", "text/html;profile=mcp-app"]]);
    const read = (await request("resources/read", { uri: "ui://opensrcer/lesson.html" })).result as { contents: Array<{ mimeType: string; text: string }> };
    assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(read.contents[0].text, /^<!doctype html>/);
    assert.match(read.contents[0].text, /"ui\/initialize"/);
    assert.equal(((await request("resources/read", { uri: "ui://other" })) as { error: { code: number } }).error.code, -32002);
  } finally {
    child.kill();
  }
});

/** A small git checkout of acme/app, and a separate worktree holding a fix. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "opensrcer-app-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "README.md"), "acme/app cleans data frames.\n");
  writeFileSync(join(dir, "app", "fill.py"), "import pandas as pd\n\ndef fill(df, value):\n    return df\n");
  writeFileSync(join(dir, "app", "core.py"), "from app.fill import fill\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  git("remote", "add", "origin", "https://github.com/acme/app.git");
  const key = `${dir}-key`;
  git("worktree", "add", "-q", key);
  writeFileSync(join(key, "app", "fill.py"), "import pandas as pd\n\ndef fill(df, value):\n    return df.fillna(value)\n");
  return { dir, key };
}

test("a lesson over stdio: the checkout's map goes up, rubrics come back, the key is read from its own worktree", async () => {
  const { dir, key } = fixture();
  const { child, request } = start(TOKEN);
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } });
    const started = await request("tools/call", { name: "lesson_start", arguments: { repo: "acme/app", issue: 12, dir } });
    assert.equal((started.result as ToolResult).isError, undefined, text(started));
    const created = JSON.parse(seen.at(-1)!.body);
    assert.equal(seen.at(-1)!.url, "/api/harness/lessons");
    assert.deepEqual([created.issue_title, created.readme.trim()], ["fill ignores value", "acme/app cleans data frames."]);
    assert.ok(created.graph.nodes.some((n: { id: string }) => n.id === "app/fill.py::fill"));
    assert.ok(created.graph.links.some((l: { source: string; target: string }) => l.source === "app/core.py" && l.target === "app/fill.py"));
    assert.ok(created.graph.nodes.some((n: { id: string }) => n.id === "ext:pandas"));
    assert.match(text(started), /Ask the user, one at a time/, "without a panel, the agent asks in chat");
    assert.match(text(started), /Prepare the hidden fix now \(lesson_key\)/);

    // A step the model judges: the rubric goes to the model; the answer is kept for the verdict.
    const rubric = await request("tools/call", { name: "lesson_answer", arguments: { lesson: LESSON_ID, step: "s1", answer: "It cleans data." } });
    assert.match(text(rubric), /^Grade the user's s1 answer yourself/);
    assert.match(text(rubric), /RUBRIC:\nJudge it/);
    const graded = await request("tools/call", { name: "lesson_answer", arguments: { lesson: LESSON_ID, step: "s1", grader_reply: '{"users":true}' } });
    assert.match(text(graded), /^s1: Passed: Clear\./);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), { step: "s1", answer: "It cleans data.", grader_reply: '{"users":true}' }, "the panel's answer is reused, not retyped");

    // The key must not be written in the user's own checkout.
    const own = await request("tools/call", { name: "lesson_key", arguments: { lesson: LESSON_ID, key_dir: dir, verified: true } });
    assert.match(text(own), /That is the user's own checkout/);
    const keyed = await request("tools/call", { name: "lesson_key", arguments: { lesson: LESSON_ID, key_dir: key, verified: true, title: "Fill with value" } });
    assert.match(text(keyed), /^Answer key stored \(verified, 1 file\)/);
    assert.match(JSON.parse(seen.at(-1)!.body).diff, /\+    return df\.fillna\(value\)/);

    // Path B reads the user's own change, without staging anything in their checkout.
    writeFileSync(join(dir, "app", "new.py"), "x = 1\n");
    await request("tools/call", { name: "lesson_submit_own", arguments: { lesson: LESSON_ID } });
    assert.match(JSON.parse(seen.at(-1)!.body).diff, /new\.py/);
    assert.equal(execFileSync("git", ["-C", dir, "diff", "--cached", "--name-only"], { encoding: "utf8" }), "", "nothing staged in the user's checkout");
  } finally {
    child.kill();
  }
});

test("the panel's map comes from the local checkout, with the user's picks and the revealed fix marked", async () => {
  const { dir } = fixture();
  const { child, request } = start(TOKEN);
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: UI_CAPS, clientInfo: { name: "vscode", version: "1" } });
    await request("tools/call", { name: "lesson_start", arguments: { repo: "acme/app", issue: 12, dir } });
    const map = (await request("tools/call", { name: "lesson_graph", arguments: { lesson: LESSON_ID } })).result as { structuredContent: { modules: Array<{ name: string; files: string[] }>; highlight: { picks: string[]; key: string[] } } };
    assert.deepEqual(map.structuredContent.modules.map((m) => m.name), ["app"]);
    assert.deepEqual(map.structuredContent.highlight, { picks: ["app/fill.py", "app/core.py"], key: ["app/fill.py"] });
  } finally {
    child.kill();
  }
});

const BAD_LESSON_CALLS: Array<[string, Record<string, unknown>, RegExp]> = [
  ["a malformed lesson id", { name: "lesson_show", arguments: { lesson: "../../x" } }, /lesson must be a lesson id/],
  ["an unknown step", { name: "lesson_hint", arguments: { lesson: LESSON_ID, step: "s99" } }, /step must be one of/],
  ["a checkout of another project", { name: "lesson_start", arguments: { repo: "other/thing", issue: 1, dir: process.cwd() } }, /doesn't look like a clone of other\/thing|not a git checkout/],
  ["a grade with no answer to grade", { name: "lesson_answer", arguments: { lesson: LESSON_ID, step: "s4", grader_reply: "{}" } }, /Send the user's answer/],
];
for (const [name, params, message] of BAD_LESSON_CALLS) {
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
