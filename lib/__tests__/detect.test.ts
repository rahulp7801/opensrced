import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectRecipe, lockfilePlan, miseRuntimes, readRecipeFiles, versionFromRange } from "../env/detect";
import { recipeHash } from "../env/recipe";

const CI = `on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -e .
      - run: pytest tests
`;

test("detection order: builtin first, whatever the files say", async () => {
  const vllm = await detectRecipe("vllm-project/vllm", { ".github/workflows/ci.yml": CI });
  assert.equal(vllm.recipe.source, "builtin");
  assert.match(vllm.recipe.setup.join("\n"), /VLLM_USE_PRECOMPILED=1/);
  const torch = await detectRecipe("pytorch/pytorch", { ".github/workflows/ci.yml": CI });
  assert.equal(torch.recipe.source, "builtin");
  assert.deepEqual(torch.recipe.setup, [], "pytorch's setup is left to the agent");
  assert.equal((await detectRecipe("React/React", {})).recipe.source, "builtin", "renamed repo, any case");
});

test("detection order: CI wins over lockfiles; mise fills runtimes CI left out; related tests inferred", async () => {
  const d = await detectRecipe("acme/widget", { ".github/workflows/ci.yml": CI, "uv.lock": "x", ".nvmrc": "20\n", ".python-version": "3.9" });
  assert.equal(d.recipe.source, "ci");
  assert.deepEqual(d.recipe.runtimes, { node: "20", python: "3.12" }, "CI's python pin beats .python-version");
  assert.deepEqual(d.recipe.test, ["pytest tests"]);
  assert.deepEqual(d.recipe.testRelated, { kind: "pytest-files", template: "pytest {targets}" });
  assert.equal(d.hash, recipeHash({ ".github/workflows/ci.yml": CI, "uv.lock": "x", ".nvmrc": "20\n", ".python-version": "3.9" }));
  assert.equal(d.partial, false);
});

test("detection order: devcontainer is described and kept; CI still supplies the tests", async () => {
  const d = await detectRecipe("acme/widget", { ".devcontainer/devcontainer.json": "{}", ".github/workflows/ci.yml": CI });
  assert.equal(d.recipe.source, "ci");
  assert.deepEqual(d.recipe.devcontainer, { path: ".devcontainer/devcontainer.json" });
  assert.ok(d.notes.some((n) => /devcontainer: .* not run yet/.test(n)));
  const only = await detectRecipe("acme/widget", { ".devcontainer/python/devcontainer.json": "{}" });
  assert.equal(only.recipe.source, "devcontainer");
  assert.deepEqual(only.recipe.devcontainer, { path: ".devcontainer/python/devcontainer.json" });
});

test("detection falls back to lockfiles when CI is missing or unreachable, and says so", async () => {
  const mac = `on: push\njobs:\n  test:\n    runs-on: macos-latest\n    steps: [{ run: swift test }]\n`;
  const d = await detectRecipe("acme/widget", { ".github/workflows/ci.yml": mac, "go.mod": "module x\n\ngo 1.22\n" });
  assert.equal(d.recipe.source, "lockfile");
  assert.equal(d.unreachable, "non_linux");
  assert.deepEqual(d.recipe.test, ["go test ./..."]);
  assert.deepEqual(d.recipe.runtimes, { go: "1.22" });
  assert.deepEqual(d.recipe.testRelated, { kind: "go-pkg", template: "go test {targets}" });
  const plain = await detectRecipe("acme/widget", { "package.json": '{"scripts":{"test":"vitest"},"devDependencies":{"vitest":"3"}}', "pnpm-lock.yaml": "" });
  assert.equal(plain.unreachable, undefined, "no CI is not 'unreachable'");
  assert.equal(plain.recipe.source, "lockfile");
  assert.deepEqual(plain.recipe.testRelated?.kind, "vitest");
});

test("detection ends at the agent marker (railpack described) when nothing is found", async () => {
  const d = await detectRecipe("acme/widget", { "README.md": "hi" });
  assert.equal(d.recipe.source, "agent");
  assert.deepEqual([d.recipe.setup, d.recipe.test], [[], []]);
  assert.ok(d.notes.some((n) => /railpack/.test(n)));
  const mise = await detectRecipe("acme/widget", { ".tool-versions": "nodejs 22.1.0\n" });
  assert.equal(mise.recipe.source, "mise");
  assert.deepEqual(mise.recipe.runtimes, { node: "22.1.0" });
  assert.equal(mise.partial, true);
});

test("lockfilePlan widens the old heuristics per ecosystem", () => {
  const cases: [Record<string, string>, string[], string[]][] = [
    [{ "uv.lock": "", "pyproject.toml": "" }, ["uv sync"], ["uv run pytest"]],
    [{ "poetry.lock": "" }, ["uvx poetry install"], ["uvx poetry run pytest"]],
    [{ "pyproject.toml": "[tool.pdm]\n" }, ["uvx pdm install"], ["uvx pdm run pytest"]],
    [{ "tox.ini": "[tox]" }, [], ["uvx tox -e py"]],
    [{ "noxfile.py": "" }, [], ["uvx nox -s tests"]],
    [{ "pyproject.toml": "[tool.hatch.envs.test]\n" }, [], ["uvx hatch test"]],
    [{ "pyproject.toml": "[project]\nname='x'\n\n[project.optional-dependencies]\ndocs = ['sphinx']\ntest = ['pytest']\ndev = ['ruff']\n\n[tool.ruff]\n" },
      ["[ -x ~/env/venv/bin/python ] || python3 -m venv ~/env/venv", "~/env/venv/bin/pip install -e '.[test,dev]' pytest"], ["~/env/venv/bin/python -m pytest"]],
    [{ "setup.py": "" }, ["[ -x ~/env/venv/bin/python ] || python3 -m venv ~/env/venv", "~/env/venv/bin/pip install -e . pytest"], ["~/env/venv/bin/python -m pytest"]],
    [{ "requirements.txt": "", "requirements-dev.txt": "" }, ["[ -x ~/env/venv/bin/python ] || python3 -m venv ~/env/venv", "~/env/venv/bin/pip install -r requirements.txt -r requirements-dev.txt pytest"], ["~/env/venv/bin/python -m pytest"]],
    [{ "package.json": '{"scripts":{"test":"jest"},"packageManager":"pnpm@9.12.0+sha512.abc"}', "pnpm-lock.yaml": "" }, ["command -v pnpm >/dev/null || npm install -g pnpm@9.12.0", "pnpm install --frozen-lockfile"], ["pnpm test"]],
    [{ "package.json": '{"scripts":{"test":"bun test"}}', "bun.lock": "" }, ["command -v bun >/dev/null || npm install -g bun", "bun install --frozen-lockfile"], ["bun run test"]],
    [{ "package.json": '{"scripts":{"test":"mocha"}}', "yarn.lock": "", ".yarnrc.yml": "" }, ["corepack enable", "yarn install --immutable"], ["yarn test"]],
    [{ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}', "package-lock.json": "" }, ["npm ci --no-audit --no-fund"], []],
    [{ "go.mod": "", "package.json": "{}" }, ["go mod download"], ["go test ./..."]],
    [{ "Cargo.toml": "" }, ["cargo fetch"], ["cargo test"]],
    [{ "mvnw": "", "pom.xml": "" }, [], ["./mvnw -B test"]],
    [{ "build.gradle.kts": "" }, [], ["gradle test"]],
    [{ "Gemfile": "gem 'rspec'" }, ["bundle install"], ["bundle exec rspec"]],
    [{ "Gemfile": "gem 'minitest'" }, ["bundle install"], ["bundle exec rake"]],
    [{ "composer.json": "{}" }, ["composer install --no-interaction --prefer-dist"], ["vendor/bin/phpunit"]],
    [{ "Makefile": "build:\n\tcc x.c\ntest: build\n\t./x\n" }, [], ["make test"]],
  ];
  for (const [files, setup, testCmds] of cases) assert.deepEqual(lockfilePlan(files) && { setup: lockfilePlan(files)!.setup, test: lockfilePlan(files)!.test }, { setup, test: testCmds }, JSON.stringify(files));
  assert.equal(lockfilePlan({}), null);
  assert.equal(lockfilePlan({ Makefile: "all:\n\tcc x.c\n" }), null);
  assert.equal(lockfilePlan({ "package.json": "{broken" }), null);
});

test("miseRuntimes reads version files and manifest fields", () => {
  assert.deepEqual(miseRuntimes({
    ".tool-versions": "nodejs 20.1.0\ngolang 1.22.0 # pinned\n\n",
    ".nvmrc": "18", ".ruby-version": "ruby-3.3.0", "rust-toolchain.toml": '[toolchain]\nchannel = "1.79"\n',
    "package.json": '{"engines":{"node":">=16"},"packageManager":"pnpm@9.1.0"}', "pyproject.toml": 'requires-python = ">=3.9,<3.13"',
  }), { node: "20.1.0", go: "1.22.0", ruby: "3.3.0", rust: "1.79", pnpm: "9.1.0", python: "3.9" });
  assert.deepEqual(miseRuntimes({ "rust-toolchain": "stable\n", "go.mod": "module x\ngo 1.21\ntoolchain go1.22.3\n", ".node-version": "v22" }), { node: "22", rust: "stable", go: "1.22.3" });
  assert.deepEqual(miseRuntimes({ "package.json": "nope" }), {});
  assert.deepEqual(miseRuntimes({}), {});
});

test("versionFromRange", () => {
  const cases: [string, string | null][] = [[">=3.9", "latest"], [">=3.9,<3.13", "3.9"], ["^18.2.0", "18.2.0"], ["~=3.11", "3.11"], ["==3.12.*", "3.12"], ["20", "20"], ["'>= 3.10'", "latest"], ["*", null], ["lts", null]];
  for (const [spec, want] of cases) assert.equal(versionFromRange(spec), want, spec);
});

test("readRecipeFiles reads the detection inputs from a checkout and nothing else", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-detect-"));
  try {
    const write = (rel: string, content: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    };
    write(".github/workflows/ci.yml", CI);
    write(".github/workflows/notes.md", "not a workflow");
    write(".github/actions/setup/action.yml", "runs: {using: composite, steps: []}");
    write(".devcontainer/py/devcontainer.json", "{}");
    write("uv.lock", "lock");
    write("src/app.py", "print(1)");
    const files = readRecipeFiles(dir);
    assert.deepEqual(Object.keys(files).sort(), [".devcontainer/py/devcontainer.json", ".github/actions/setup/action.yml", ".github/workflows/ci.yml", "uv.lock"]);
    assert.equal(files["uv.lock"], "lock");
    assert.deepEqual(readRecipeFiles(path.join(dir, "missing")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
