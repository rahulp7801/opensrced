// Plain-Node tests of vscode/core.js: `node --test vscode/test/`.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TokenFormatError, cleanToken, siteUrl, serverLaunch, describeMe, mapHtml, parseMap, parseIssue } = require("../core");

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
