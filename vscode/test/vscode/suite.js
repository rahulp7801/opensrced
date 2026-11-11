// Runs inside a real VS Code (test/vscode/run.mjs starts it with this extension in
// development mode and a throwaway profile). Writes its results to OPENSRCER_TEST_OUT,
// because a Windows GUI process has no console to print to.

"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TOKEN = `osh_${"t".repeat(32)}`;
const results = [];
const out = process.env.OPENSRCER_TEST_OUT || path.join(require("node:os").tmpdir(), "opensrcer-vscode-results.json");
// Saved after every check, so a run that hangs still shows how far it got.
const save = () => fs.writeFileSync(out, JSON.stringify(results, null, 2));
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 2000) }); save(); };
const wait = async (what, fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`timed out waiting for ${what}`);
};

/** A stand-in for the opensrcer site: GET /api/harness/me knows one token. */
function fakeSite() {
  const server = http.createServer((req, res) => {
    const known = req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(req.url === "/api/harness/me" ? (known ? 200 : 401) : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(known ? { login: "tester", today: { lessons: { used: 0, limit: 20 }, new_maps: { used: 0, limit: 5 } } } : { error: "no" }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Starts the server exactly as VS Code would from the definition, and talks MCP to it. */
async function mcp(def, calls) {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(def.env)) { if (v === null) delete env[k]; else env[k] = String(v); }
  const child = spawn(def.command, def.args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const replies = new Map();
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (line.trim()) { const m = JSON.parse(line); if (m.id !== undefined) replies.set(m.id, m); }
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const send = async (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return wait(`${method} reply (stderr: ${stderr.slice(0, 300)})`, () => replies.get(id), 60_000);
  };
  try {
    const init = await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const out = { init };
    let id = 2;
    for (const [key, method, params] of calls) out[key] = await send(id++, method, params);
    return out;
  } finally {
    child.kill();
  }
}

async function run() {
  check("info: suite started", true, `results go to ${out}`);
  try {
    const ext = vscode.extensions.getExtension("opensrcer.opensrcer");
    check("extension found", ext);
    const api = await Promise.race([ext.activate(), new Promise((_, reject) => setTimeout(() => reject(new Error("activation took over 3 minutes")), 180_000))]);
    check("extension activates", api && typeof api.definition === "function");

    // 1. The server as VS Code launches it, with no token yet.
    const site = await fakeSite();
    const url = `http://127.0.0.1:${site.address().port}`;
    await vscode.workspace.getConfiguration("opensrcer").update("url", url, vscode.ConfigurationTarget.Global);
    let def = await api.definition();
    check("definition uses VS Code's own runtime", def.command === process.execPath, def.command);
    check("definition is a stdio definition", def instanceof vscode.McpStdioServerDefinition);
    check("no token yet", def.env.OPENSRCER_TOKEN === null, def.env.OPENSRCER_TOKEN);
    let r = await mcp(def, [["tools", "tools/list", {}], ["setup", "tools/call", { name: "setup_check", arguments: {} }]]);
    const names = (r.tools.result?.tools ?? []).map((t) => t.name);
    check("server starts under VS Code's runtime and lists its tools", names.includes("setup_check") && names.includes("lesson_start"), names.join(","));
    check("server reports its version", r.init.result?.serverInfo?.version, JSON.stringify(r.init.result?.serverInfo));
    const setupText = r.setup.result?.content?.[0]?.text ?? "";
    check("without a token, setup_check says to run 'opensrcer: Sign in'", /opensrcer: Sign in/.test(setupText), setupText);

    // 2. Signing in: a token the site rejects isn't stored; a good one is, and reaches the server.
    let refused = "";
    try { await api.saveToken(`osh_${"x".repeat(32)}`); } catch (error) { refused = error.message; }
    check("a token the site doesn't know is refused", /doesn't know that token/.test(refused), refused);
    const verdict = await api.saveToken(TOKEN);
    check("a good token is checked with the site", verdict.ok && /@tester/.test(verdict.text), JSON.stringify(verdict));
    def = await wait("the token in the definition", async () => { const d = await api.definition(); return d.env.OPENSRCER_TOKEN === TOKEN && d; });
    check("the stored token goes to the server", def.env.OPENSRCER_TOKEN === TOKEN);
    r = await mcp(def, [["setup", "tools/call", { name: "setup_check", arguments: {} }]]);
    const signedIn = r.setup.result?.content?.[0]?.text ?? "";
    check("setup_check through the extension's launch says signed in", /Signed in to opensrcer as @tester/.test(signedIn), signedIn);
    site.close();

    // 3. The map tab opens when the server writes a lesson's map.
    fs.writeFileSync(path.join(api.mapDir, "current.json"), JSON.stringify({ lesson: "l_test", stage: "locate", title: "pallets/itsdangerous #429", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#4E79A7"/></svg>', explored: ["src/itsdangerous/serializer.py"], changed: [] }));
    await wait("the map tab", () => api.panelOpen(), 10_000).then(() => check("map tab opens beside the editor", true), (e) => check("map tab opens beside the editor", false, e.message));
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));
    check("map tab is labelled", tabs.includes("opensrcer map"), tabs.join(" | "));

    // 4. VS Code's own MCP host: does the provider show up, and do the tools reach the language-model tool list?
    const cmds = (await vscode.commands.getCommands(true)).filter((c) => /mcp/i.test(c));
    check("info: MCP commands in this VS Code", true, cmds.join(", "));
    const lmTools = () => vscode.lm.tools.filter((t) => /setup_check|lesson_start/.test(t.name)).map((t) => t.name);
    check("info: opensrcer tools in vscode.lm.tools before any start", true, lmTools().join(",") || "(none)");
  } catch (error) {
    check("suite ran to the end", false, error && error.stack || error);
  } finally {
    check("info: suite finished", true);
  }
  if (results.some((r) => !r.ok)) throw new Error(`${results.filter((r) => !r.ok).length} check(s) failed`);
}

module.exports = { run };
