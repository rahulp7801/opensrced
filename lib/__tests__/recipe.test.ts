import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CI_SHIM, CI_SHIM_BETWEEN_STEPS, DEFAULT_TIMEOUTS, envQuote, recipeHash, runtimeCommand, serviceCommands, setupScript, type EnvRecipe } from "../env/recipe";

const recipe = (over: Partial<EnvRecipe> = {}): EnvRecipe => ({
  repo: "o/r", source: "ci", runtimes: {}, services: [], env: {}, setup: [], test: [], lint: [], timeouts: { ...DEFAULT_TIMEOUTS }, ...over,
});

test("recipeHash ignores input order and changes with any content", () => {
  const a = recipeHash({ "a.yml": "x", "b.lock": "y" });
  assert.equal(recipeHash({ "b.lock": "y", "a.yml": "x" }), a);
  assert.notEqual(recipeHash({ "a.yml": "x", "b.lock": "z" }), a);
  assert.notEqual(recipeHash({ "a.yml": "x", "c.lock": "y" }), a, "the path is part of the hash");
  assert.equal(recipeHash({ "a.yml": "x", "b.lock": "y", gone: null }), a, "null means absent");
  assert.notEqual(recipeHash({ "a.yml": "x", "b.lock": "y", empty: "" }), a, "an empty file is not an absent one");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(recipeHash({}), recipeHash({ x: null }));
});

test("envQuote keeps values literal but lets $GITHUB_WORKSPACE expand (executed)", () => {
  const out = execFileSync("bash", ["-c", `GITHUB_WORKSPACE=/w; export A=${envQuote("$GITHUB_WORKSPACE/go")} B=${envQuote("it's $HOME")}; echo "$A|$B"`], { encoding: "utf8" });
  assert.equal(out.replace(/\r/g, ""), "/w/go|it's $HOME\n");
});

test("serviceCommands quote env and image, publish ports, and never fail setup", () => {
  const [cmd] = serviceCommands([{ name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "it's" }, ports: [5432] }]);
  assert.match(cmd, /^docker run -d --name 'opensrcer-postgres' -e 'POSTGRES_PASSWORD=it'\\''s' -p 5432:5432 'postgres:16' \|\| echo/);
  assert.deepEqual(serviceCommands([]), []);
});

test("runtimeCommand uses mise when present and says so when not", () => {
  assert.equal(runtimeCommand({}), null);
  const cmd = runtimeCommand({ python: "3.12", node: "" })!;
  assert.match(cmd, /mise use -g --yes 'python@3\.12' 'node@latest'/);
  assert.match(cmd, /mise is not in this image/);
  const out = execFileSync("bash", ["-c", `PATH=/nonexistent; ${cmd.replace(/command -v mise/, "false")}`], { encoding: "utf8" });
  assert.match(out, /using its preinstalled runtimes instead of python@3\.12 node@latest/);
});

test("setupScript orders env, runtimes, services, steps; the CI shim only for CI recipes", () => {
  const ci = setupScript(recipe({ env: { A: "1" }, runtimes: { go: "1.22" }, services: [{ name: "redis", image: "redis" }], setup: ["s1", "s2"] }));
  assert.equal(ci[0], CI_SHIM);
  assert.equal(ci[1], "export A='1'");
  assert.match(ci[2], /mise use/);
  assert.match(ci[3], /docker run/);
  assert.deepEqual(ci.slice(4), ["s1", CI_SHIM_BETWEEN_STEPS, "s2", CI_SHIM_BETWEEN_STEPS]);
  assert.deepEqual(setupScript(recipe({ source: "lockfile", setup: ["npm ci"] })), ["npm ci"]);
  assert.deepEqual(setupScript(recipe({ source: "agent" })), []);
});

test("the CI shim carries GITHUB_ENV and GITHUB_PATH between steps under set -e", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-shim-"));
  try {
    const steps = setupScript(recipe({ setup: [
      `echo "GREETING=hello world" >> "$GITHUB_ENV"; echo "multi<<EOF" >> "$GITHUB_ENV"; mkdir -p bin && printf '#!/bin/sh\\necho shimmed\\n' > bin/tool && chmod +x bin/tool && echo "$PWD/bin" >> "$GITHUB_PATH"`,
      `echo "$GREETING" > out.txt && tool >> out.txt && echo "$CI" >> out.txt`,
    ] }));
    execFileSync("bash", ["-c", ["set -e", ...steps].join("\n")], { cwd: dir, encoding: "utf8" });
    const out = execFileSync("bash", ["-c", "cat out.txt"], { cwd: dir, encoding: "utf8" });
    assert.equal(out.replace(/\r/g, ""), "hello world\nshimmed\ntrue\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
