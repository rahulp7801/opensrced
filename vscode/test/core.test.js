// Plain-Node tests of vscode/core.js: `node --test vscode/test/`.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TokenFormatError, cleanToken, siteUrl, serverLaunch, describeMe, mapHtml, viewerHtml, parseMap, parseIssue, mapIsMine } = require("../core");
const path = require("node:path");

const GOOD = `osh_${"aB3_-".repeat(6)}xy`;

test("cleanToken accepts a token, trimmed, with or without 'Bearer'", () => {
  assert.equal(cleanToken(`  ${GOOD}\n`), GOOD);
  assert.equal(cleanToken(`Bearer ${GOOD}`), GOOD);
});

for (const [name, raw, message] of [
  ["empty", "", /Paste the token/],
  ["undefined", undefined, /Paste the token/],
  ["another service's key", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", /start with osh_/],
  ["cut off", "osh_abc", /cut off/],
  ["too long", `${GOOD}z`, /cut off/],
  ["bad character", `osh_${"a".repeat(31)}!`, /cut off/],
]) {
  test(`cleanToken refuses ${name}`, () => assert.throws(() => cleanToken(raw), (e) => e instanceof TokenFormatError && message.test(e.message)));
}

test("siteUrl: default, trailing slash, https, localhost http", () => {
  assert.equal(siteUrl(""), "https://opensrced.vercel.app");
  assert.equal(siteUrl("https://example.org/"), "https://example.org");
  assert.equal(siteUrl("http://localhost:3124"), "http://localhost:3124");
  assert.throws(() => siteUrl("http://example.org"), TokenFormatError);
  assert.throws(() => siteUrl("not a url"), TokenFormatError);
});

test("serverLaunch runs VS Code's runtime as Node, with the token and map folder", () => {
  const l = serverLaunch({ execPath: "/vs/code", serverPath: "/ext/server/server.mjs", token: GOOD, url: "https://x.org", mapDir: "/g/maps", graphPython: "" });
  assert.equal(l.command, "/vs/code");
  assert.deepEqual(l.args, ["/ext/server/server.mjs"]);
  assert.equal(l.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(l.env.OPENSRCER_TOKEN, GOOD);
  assert.equal(l.env.OPENSRCER_CLIENT, "vscode-extension");
  assert.equal(l.env.OPENSRCER_MAP_DIR, "/g/maps");
  assert.equal("OPENSRCER_GRAPH_PYTHON" in l.env, false);
});

test("serverLaunch without a token removes an inherited one; graphPython is passed when set", () => {
  const l = serverLaunch({ execPath: "e", serverPath: "s", token: "", url: "u", mapDir: "m", graphPython: "/py" });
  assert.equal(l.env.OPENSRCER_TOKEN, null);
  assert.equal(l.env.OPENSRCER_GRAPH_PYTHON, "/py");
});

test("describeMe: signed in, rejected, no access, other", () => {
  assert.deepEqual(describeMe(200, { login: "ada" }), { ok: true, text: "Signed in to opensrcer as @ada." });
  assert.equal(describeMe(401, {}).rejected, true);
  assert.equal(describeMe(403, { error: "Open your class link." }).text, "Open your class link.");
  assert.match(describeMe(403, null).text, /class link/);
  assert.match(describeMe(503, {}).text, /503/);
});

test("mapHtml escapes everything but the server's SVG, and runs no script", () => {
  const html = mapHtml({ lesson: "l_1", stage: "locate", title: "<b>o/n</b> #1", svg: "<svg><circle/></svg>", explored: ["a<script>.py"], changed: [] }, "vscode-resource:");
  assert.match(html, /&lt;b&gt;o\/n&lt;\/b&gt; #1/);
  assert.match(html, /<svg><circle\/><\/svg>/);
  assert.match(html, /a&lt;script&gt;\.py/);
  assert.match(html, /Finding where to look/);
  assert.doesNotMatch(html, /Changed by the fix<\/strong>/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script/);
});

test("mapHtml drops an 'svg' that isn't one, and explains an empty map", () => {
  assert.doesNotMatch(mapHtml({ lesson: "l", stage: "done", svg: "<img src=x onerror=alert(1)>" }, ""), /<img/);
  assert.match(mapHtml(null, ""), /No lesson yet/);
});

test("parseMap: a map, half-written JSON, the wrong shape", () => {
  assert.equal(parseMap('{"lesson":"l_1","svg":"<svg/>"}').lesson, "l_1");
  assert.equal(parseMap('{"lesson":"l_1"'), null);
  assert.equal(parseMap("[]"), null);
  assert.equal(parseMap('{"svg":1}'), null);
});

for (const [text, want] of [
  ["https://github.com/pallets/itsdangerous/issues/429", { repo: "pallets/itsdangerous", number: 429 }],
  ["https://github.com/pallets/itsdangerous/issues/429/", { repo: "pallets/itsdangerous", number: 429 }],
  ["https://github.com/pallets/itsdangerous/issues/429#issuecomment-1", { repo: "pallets/itsdangerous", number: 429 }],
  ["github.com/earthlab/earthpy/issues/953", { repo: "earthlab/earthpy", number: 953 }],
  ["earthlab/earthpy#953", { repo: "earthlab/earthpy", number: 953 }],
  ["owner/name.js 12", { repo: "owner/name.js", number: 12 }],
  ["https://github.com/pallets/itsdangerous", null],
  ["pallets/itsdangerous#0", null],
  ["owner/..#3", null],
  ["https://gitlab.com/a/b/issues/1", null],
  ["", null],
]) {
  test(`parseIssue(${JSON.stringify(text)})`, () => assert.deepEqual(parseIssue(text), want));
}

test("viewerHtml: graphify's page with a CSP first in its head (scripts inline and from unpkg only, no network); not a page → null", () => {
  const page = viewerHtml('<html><head><title>g</title></head><body><script src="https://unpkg.com/vis-network@9.1.6/x.js"></script></body></html>', "vscode-resource:");
  const meta = page.match(/^<html><head><meta http-equiv="Content-Security-Policy" content="([^"]+)"><title>/);
  assert.ok(meta, "the CSP comes before anything else in the head");
  assert.match(meta[1], /default-src 'none'/);
  assert.match(meta[1], /script-src 'unsafe-inline' https:\/\/unpkg\.com;/);
  assert.match(meta[1], /connect-src 'none'/);
  assert.doesNotMatch(meta[1], /unsafe-eval/);
  assert.match(viewerHtml('<HTML><HEAD lang="en"></HEAD></HTML>', "x"), /^<HTML><HEAD lang="en"><meta http-equiv/);
  for (const bad of ["", "no html here", null, undefined]) assert.equal(viewerHtml(bad, "x"), null);
  // A narrow editor tab: graphify's 280 px side panel slides over the graph from a button, just before </body>.
  assert.match(page, /<button id="osr-panel-toggle"[^>]*aria-controls="sidebar"[^>]*>Search<\/button>[\s\S]*<\/script>\n<\/body><\/html>$/);
  assert.match(page, /@media \(max-width:759px\)/);
});

test("viewerHtml: offline, the page shows the still map and says why (vis-network didn't load)", () => {
  const graphify = '<html><head></head><body><script src="https://unpkg.com/vis-network@9.1.6/x.js"></script></body></html>';
  const page = viewerHtml(graphify, "x", '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
  assert.match(page, /<div id="osr-offline" hidden[^>]*>[\s\S]*couldn't load: it needs vis-network from unpkg\.com[\s\S]*<svg style="width:100%;height:auto" xmlns=/);
  assert.match(page, /if \(typeof vis === "undefined"\) document\.getElementById\("osr-offline"\)\.hidden = false/);
  assert.doesNotMatch(viewerHtml(graphify, "x", "<script>alert(1)</script>"), /alert\(1\)/, "only an SVG is taken as the fallback");
});

test("viewerHtml: a page without vis-network (the file map) gets the CSP but no offline notice or panel button", () => {
  const page = viewerHtml("<html><head></head><body><main>cards</main></body></html>", "x", "<svg></svg>");
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(page, /osr-offline|osr-panel-toggle/);
});

test("mapIsMine: only the window whose folders hold the lesson (its checkout or the agent's folder) opens the map", () => {
  const root = path.resolve("/work");
  const app = path.join(root, "app");
  const map = (places) => ({ lesson: "l_1", stage: "kickoff", places });
  assert.equal(mapIsMine(map([path.join(root, "agent"), path.join(app, "src")]), [app]), true, "the checkout is inside the folder");
  assert.equal(mapIsMine(map([app]), [app]), true, "the folder itself");
  assert.equal(mapIsMine(map([path.join(root, "app-other")]), [app]), false, "a sibling whose name starts the same isn't inside");
  assert.equal(mapIsMine(map([path.join(root, "elsewhere")]), [app, path.join(root, "docs")]), false, "another project's lesson");
  assert.equal(mapIsMine(map([app]), []), false, "a window with no folder shows no one's lesson");
  assert.equal(mapIsMine({ lesson: "l_1", stage: "kickoff" }, []), true, "a map from an older plugin (no places) is every window's");
  assert.equal(mapIsMine(map([app.toUpperCase()]), [app], "win32"), true, "Windows paths match whatever their case");
  assert.equal(mapIsMine(map([app.toUpperCase()]), [app], "linux"), app.toUpperCase() === app, "elsewhere case counts");
});
