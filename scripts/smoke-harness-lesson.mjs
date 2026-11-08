// The harness's whole lesson flow, for real, minus Next and a model:
//
//   the real lesson engine (lib/harness-lessons.ts, compiled by `npm test`)
//   on PGlite, behind a small HTTP server with the route's token check
//     ↑ HTTP
//   the real plugin server (harness/server.mjs) over stdio, as a host runs it
//     ↑ MCP Apps (postMessage)
//   the real lesson panel (harness/views/lesson.html) in Chromium, inside a
//   minimal host page that sandboxes it under the spec's default CSP plus
//   the domains the resource declares, with graphify's real map in its Map tab
//
// This script plays the host and the agent: it starts the lesson, writes the
// hidden fix in a separate worktree, and when the panel asks for a grade it
// answers with a verdict, as the contributor's agent would after reading
// the rubric. Run after `npm test` (it needs .test-build), with graphify
// installed (requirements-graph.txt; OPENSRCER_GRAPH_PYTHON picks the Python)
// and `npx playwright install chromium`. SMOKE_SHOTS=<dir> saves screenshots.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const { openDb } = require(join(root, ".test-build/lib/db/client.js"));
const { migrateDb } = require(join(root, ".test-build/lib/db/migrate.js"));
const { createToken, harnessUser } = require(join(root, ".test-build/lib/harness.js"));
const L = require(join(root, ".test-build/lib/harness-lessons.js"));
const { DbLessonStore } = require(join(root, ".test-build/lib/lesson/db-store.js"));

process.env.OPENSRCER_LESSONS = "1";
const shots = process.env.SMOKE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ── The checkout, and the agent's hidden fix in its own worktree ─────────
const dir = mkdtempSync(join(tmpdir(), "opensrcer-smoke-app-"));
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
git(dir, "init", "-q"); git(dir, "config", "user.email", "t@example.com"); git(dir, "config", "user.name", "t");
mkdirSync(join(dir, "app")); mkdirSync(join(dir, "tests"));
writeFileSync(join(dir, "README.md"), "# app\n\nacme/app cleans pandas data frames for analysts: fill gaps, rename columns, drop junk.\n");
writeFileSync(join(dir, "app", "fill.py"), "import pandas as pd\n\n\ndef fill(df, value):\n    \"\"\"Fill missing values with value.\"\"\"\n    return df\n");
writeFileSync(join(dir, "app", "core.py"), "from app.fill import fill\n\n\ndef clean(df):\n    return fill(df, 0)\n");
writeFileSync(join(dir, "tests", "test_fill.py"), "import pandas as pd\nfrom app.fill import fill\n");
git(dir, "add", "-A"); git(dir, "commit", "-qm", "init");
git(dir, "remote", "add", "origin", "https://github.com/acme/app.git");
const keyDir = `${dir}-key`;
git(dir, "worktree", "add", "-q", keyDir);
writeFileSync(join(keyDir, "app", "fill.py"), "import pandas as pd\n\n\ndef fill(df, value):\n    \"\"\"Fill missing values with value.\"\"\"\n    return df.fillna(value)\n");
writeFileSync(join(keyDir, "tests", "test_fill.py"), "import pandas as pd\nfrom app.fill import fill\n\n\ndef test_fill_uses_value():\n    assert fill(pd.DataFrame({'a': [None]}), 0)['a'][0] == 0\n");

// ── The opensrcer API: the real engine on PGlite ─────────────────────────
const connection = await openDb({ driver: "pglite" });
await migrateDb(connection);
const db = connection.db;
const { token } = await createToken(db, "github|smoke", "smoker", "smoke");
const invited = async () => true;

const api = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, "http://x");
  const send = async (response) => {
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  if (url.pathname === "/repos/acme/app/issues/12") return send(Response.json({ title: "fill ignores its value", body: "Calling fill(df, 0) leaves the NaN values in place." }));
  if (url.pathname === "/host.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(HOST); }
  const m = /^\/api\/harness\/lessons(?:\/([^/]+)(?:\/(\w+))?)?$/.exec(url.pathname);
  if (!m) return send(Response.json({ error: "not found" }, { status: 404 }));
  let userId;
  try { userId = await harnessUser(db, req.headers.authorization ?? null, invited); }
  catch (error) { return send(Response.json({ error: error.message }, { status: error.status ?? 401 })); }
  const request = new Request(url, { method: req.method, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const [, id, action] = m;
  if (!id) return send(await L.createHarnessLesson(request, db, userId));
  if (req.method === "GET") return send(await L.getHarnessLesson(id, db, userId));
  const handler = { answer: L.answerHarnessStep, hint: L.harnessHint, key: L.setHarnessKey, reveal: L.harnessReveal }[action];
  if (handler) return send(await handler(request, id, db, userId));
  if (action === "diff") return send(await L.harnessOwnDiff(request, id, db, userId, url.searchParams.get("submit") === "1"));
  return send(Response.json({ error: "not found" }, { status: 404 }));
});
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${api.address().port}`;

// ── The plugin server, as a host that renders MCP Apps runs it ───────────
const plugin = spawn(process.execPath, [join(root, "harness", "server.mjs")], {
  env: { ...process.env, OPENSRCER_URL: base, OPENSRCER_TOKEN: token, GITHUB_API_URL: base, OPENSRCER_HOME: mkdtempSync(join(tmpdir(), "opensrcer-smoke-home-")) },
});
const waiting = new Map();
let nextId = 0;
createInterface({ input: plugin.stdout }).on("line", (line) => { const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); });
plugin.stderr.on("data", (d) => process.stderr.write(d));
const mcp = (method, params) => new Promise((resolve) => { const id = ++nextId; waiting.set(id, resolve); plugin.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args) => {
  const r = await mcp("tools/call", { name, arguments: args });
  assert.ok(r.result && !r.result.isError, `${name}: ${JSON.stringify(r.result ?? r.error).slice(0, 400)}`);
  return r.result;
};

await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, clientInfo: { name: "smoke-host", version: "1" } });
const tools = (await mcp("tools/list")).result.tools;
assert.equal(tools.find((t) => t.name === "lesson_start")._meta.ui.resourceUri, "ui://opensrcer/lesson.html");

const startArgs = { repo: "acme/app", issue: 12, dir };
const started = await call("lesson_start", startArgs);
const lessonId = started.structuredContent.lesson.id;
assert.match(started.content[0].text, /Open in the lesson panel/);
// The agent writes the hidden fix in its own worktree and stores it as the key.
const keyed = await call("lesson_key", { lesson: lessonId, key_dir: keyDir, verified: true, title: "Fill missing values with the given value", diagnosis: "fill returned the frame unchanged instead of calling fillna." });
assert.match(keyed.content[0].text, /Answer key stored \(verified, 2 files\)/);
const view = (await mcp("resources/read", { uri: "ui://opensrcer/lesson.html" })).result.contents[0];
assert.equal(view.mimeType, "text/html;profile=mcp-app");

// ── The host page: the panel in a sandboxed iframe under the default CSP ──
// The spec's default CSP, widened only by the domains the resource declares
// (graphify's viewer loads vis-network from unpkg), as a host must.
const domains = (view._meta?.ui?.csp?.resourceDomains ?? []).join(" ");
assert.equal(domains, "https://unpkg.com");
const CSP = `default-src 'none'; script-src 'self' 'unsafe-inline' ${domains}; style-src 'self' 'unsafe-inline' ${domains}; img-src 'self' data: ${domains}; font-src ${domains}; media-src 'self' data:; connect-src 'none';`;
const HOST = `<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0;background:#fff">
<iframe id="view" title="opensrcer lesson" sandbox="allow-scripts" style="width:720px;height:900px;border:0"></iframe>
<script>
window.hostLog = [];
const frame = document.getElementById("view");
const reply = (id, result) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id, result }, "*");
window.addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow) return;
  const m = event.data;
  if (!m || m.jsonrpc !== "2.0" || !m.method) return;
  window.hostLog.push(m);
  if (m.method === "ui/initialize") return reply(m.id, { protocolVersion: "2026-01-26", hostCapabilities: { openLinks: {}, serverTools: {} }, hostInfo: { name: "smoke-host", version: "1" }, hostContext: { theme: "light", displayMode: "inline" } });
  if (m.method === "ui/notifications/initialized") {
    frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: window.toolArgs } }, "*");
    frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: window.toolResult }, "*");
    return;
  }
  if (m.method === "tools/call") {
    const r = await window.mcp("tools/call", m.params);
    return frame.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, ...(r.error ? { error: r.error } : { result: r.result }) }, "*");
  }
  if (m.method === "ui/message") return reply(m.id, {});
});
window.load = (html) => { frame.srcdoc = html.replace("<head>", ${JSON.stringify(`<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)}); };
</script></body></html>`;

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const failures = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 760, height: 960 } })).newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.exposeFunction("mcp", (method, params) => mcp(method, params));
  await page.goto(`${base}/host.html`);
  await page.evaluate(({ args, result }) => { window.toolArgs = args; window.toolResult = result; }, { args: startArgs, result: started });
  await page.evaluate((html) => window.load(html), view.text);
  const panel = page.frameLocator("#view");
  await panel.getByRole("heading", { name: /acme\/app #12/ }).waitFor();

  /** The agent's side: wait for the panel to ask, then grade with a verdict. */
  const gradeWhenAsked = async (step, verdict) => {
    await page.waitForFunction((s) => window.hostLog.some((m) => m.method === "ui/message" && m.params.content.text.includes(`step ${s},`)), step);
    const graded = await call("lesson_answer", { lesson: lessonId, step, grader_reply: JSON.stringify(verdict) });
    assert.match(graded.content[0].text, new RegExp(`^${step}: Passed`), graded.content[0].text);
  };
  const card = (title) => panel.getByRole("region", { name: title });
  const words = (n, w) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

  // s1: written in the panel, graded by the agent, shown done in the panel.
  await card("What the project does").getByRole("textbox").fill(`acme/app is a small library analysts use to clean pandas data frames. ${words(60, "detail")}`);
  await card("What the project does").getByRole("button", { name: "Submit" }).click();
  await card("What the project does").getByText("your agent is checking…").waitFor();
  // What they wrote stays on screen while the agent grades it (it isn't saved until then).
  assert.match(await card("What the project does").getByRole("textbox").inputValue(), /^acme\/app is a small library/);
  assert.equal(await panel.getByText("null", { exact: true }).count(), 0);
  if (shots) await page.screenshot({ path: join(shots, "1-waiting-for-agent.png") });
  await gradeWhenAsked("s1", { users: true, purpose: true, parts: 2, feedback: "Clear: who uses it, what for, and two parts." });
  await card("What the project does").getByText("done", { exact: true }).waitFor();
  await card("What the project does").getByText("Clear: who uses it").waitFor();

  // A hint, straight from the engine.
  const task = card("The task");
  await task.getByRole("button", { name: "Hint" }).click();
  await task.locator(".hint").waitFor();

  await task.getByRole("textbox").fill(`fill(df, 0) should replace the missing values with zero, but the frame comes back unchanged. Analysts calling clean() hit it. ${words(10, "repro")}`);
  await task.getByRole("button", { name: "Submit" }).click();
  await gradeWhenAsked("s4", { behaviour: true, repro: true, feedback: "Good repro." });
  await panel.locator('li[aria-current="step"]', { hasText: "Locate" }).waitFor();

  // s7: graded by graph distance to the key, no model.
  const locate = card("Three starting points");
  await locate.getByRole("textbox").fill("app/fill.py\napp/core.py\ntests/test_fill.py");
  await locate.getByRole("button", { name: "Submit" }).click();
  await locate.getByText(/app\/fill\.py: on target/).waitFor();
  assert.equal(await locate.getByRole("textbox").inputValue(), "app/fill.py\napp/core.py\ntests/test_fill.py", "a list answer reads back as lines, not JSON");

  // s8, then the reveal.
  const predict = card("Predict the change and the test");
  await predict.getByRole("textbox").fill(`fill ignores value because it returns df as is; it should call df.fillna(value). A test that fills a NaN with 0 fails now and passes after. ${words(40, "because")}`);
  await predict.getByRole("button", { name: "Submit" }).click();
  await gradeWhenAsked("s8", { cause: true, change: true, proof: true, alternative: false, feedback: "Right cause and a good test." });
  await panel.getByRole("button", { name: "Show the fix" }).click();
  await panel.getByRole("region", { name: "The fix" }).getByText(/fillna\(value\)/).waitFor();
  if (shots) await page.screenshot({ path: join(shots, "2-revealed.png"), fullPage: true });

  // explain-it: one sentence per changed file, and why the test proves it.
  const explain = card("Explain it");
  await explain.getByRole("textbox", { name: "What the change does in app/fill.py" }).fill("It now passes the value on to fillna so gaps are filled.");
  await explain.getByRole("textbox", { name: "What the change does in tests/test_fill.py" }).fill("It adds a test that fills a missing cell with zero.");
  await explain.getByRole("textbox", { name: "Why the test proves the fix" }).fill("Without the fix the cell stays missing so the assert fails; with fillna it becomes zero and passes.");
  await explain.getByRole("button", { name: "Submit" }).click();
  await gradeWhenAsked("explain-it", { proves: true, feedback: "That is why the test proves it." });
  const next = card("Next steps");
  await next.getByRole("textbox").fill("Open the PR, then look at the rename issue.");
  await next.getByRole("button", { name: "Submit" }).click();
  await panel.getByText("Lesson done.").waitFor();

  // The map: graphify's own viewer, recoloured by the lesson (the site's overlay).
  await panel.getByRole("tab", { name: "Map" }).click();
  const map = panel.frameLocator('iframe[title="Code map from graphify"]');
  await map.getByText("your starting points").waitFor({ timeout: 60_000 });
  await map.getByText("changed by the fix").waitFor();
  const colours = await map.locator("body").evaluate(() => Object.fromEntries(nodesDS.get().map((n) => [n.id, n.color?.background])));
  assert.equal(colours.app_core, "#4E79A7", "a starting point the user picked is blue");
  assert.equal(colours.app_fill, "#EDC948", "a file the fix changed is yellow");
  if (shots) await page.screenshot({ path: join(shots, "3-map.png"), fullPage: true });

  const axe = await new AxeBuilder({ page }).include("#view").analyze();
  const serious = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  assert.deepEqual(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), []);

  const stored = await new DbLessonStore(async () => db).get(lessonId);
  assert.equal(stored.stage, "done");
  assert.deepEqual(Object.values(stored.steps).filter((s) => s.done).map((s) => s.step).sort(), ["explain-it", "s1", "s10", "s4", "s7", "s8"]);
  const csp = errors.filter((e) => /Content Security Policy|Refused to/.test(e));
  assert.deepEqual(csp, [], "the panel loads nothing outside itself");
  assert.deepEqual(errors, []);
  console.log(`harness lesson smoke: ok (lesson ${lessonId} done, ${tools.length} tools, panel under the default CSP, axe clean)`);
} catch (error) {
  failures.push(error);
} finally {
  await browser.close();
  plugin.kill();
  api.close();
  await connection.close();
}
if (failures.length) { console.error(failures[0]); process.exit(1); }
