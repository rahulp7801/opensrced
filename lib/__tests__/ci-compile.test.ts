import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chooseMatrixCell, classifyRunsOn, compileCi, isLintScript, isTestScript, normalizeVersion, stepCommand, versionFromFile, type CompileResult,
} from "../env/ci-compile";

// ── Real workflows: one expected recipe per repository ───────────────────
//
// lib/__tests__/fixtures/workflows/<owner>__<repo>/ holds that repository's
// .github/workflows (plus the local actions and version files they point
// at), fetched read-only at the commit in SOURCE. expected.json is the
// recipe we expect, checked by hand against each workflow.
// UPDATE_CI_SNAPSHOTS=1 rewrites them; review the diff before committing.

const FIXTURES = path.join(process.cwd(), "lib/__tests__/fixtures/workflows");

function readTree(root: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(root, rel))) {
    const p = rel ? `${rel}/${name}` : name;
    if (!rel && (name === "SOURCE" || name === "expected.json")) continue;
    if (statSync(path.join(root, p)).isDirectory()) Object.assign(out, readTree(root, p));
    else out[p] = readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
  }
  return out;
}

const snapshot = (r: CompileResult) => ({
  workflow: r.workflow ?? null,
  job: r.job ?? null,
  unreachable: r.unreachable ?? null,
  partial: r.partial,
  unknownActions: r.unknownActions.map((a) => a.uses),
  recipe: r.recipe,
});

for (const dir of readdirSync(FIXTURES).sort()) {
  const repo = dir.replace("__", "/");
  test(`compileCi on ${repo}'s real workflows`, async () => {
    const result = await compileCi({ repo, files: readTree(path.join(FIXTURES, dir)) });
    const expectedPath = path.join(FIXTURES, dir, "expected.json");
    if (process.env.UPDATE_CI_SNAPSHOTS === "1") writeFileSync(expectedPath, `${JSON.stringify({ ...snapshot(result), notes: result.notes }, null, 2)}\n`);
    const { notes: _notes, ...expected } = JSON.parse(readFileSync(expectedPath, "utf8")) as ReturnType<typeof snapshot> & { notes: string[] };
    assert.deepEqual(snapshot(result), expected, result.notes.join("\n"));
  });
}

test("the fixture set covers at least 25 real repositories", () => {
  assert.ok(readdirSync(FIXTURES).length >= 25);
});

// ── Pieces ────────────────────────────────────────────────────────────────

test("chooseMatrixCell: newest stable version on ubuntu, after include/exclude", () => {
  assert.deepEqual(chooseMatrixCell({ python: ["3.10", "3.13", "3.14-dev", "pypy-3.11"], os: ["windows-latest", "ubuntu-latest", "macos-latest"] })?.cell, { python: "3.13", os: "ubuntu-latest" });
  assert.deepEqual(chooseMatrixCell({ node: [18, 20, 22], exclude: [{ node: 22 }] })?.cell, { node: 20 });
  assert.deepEqual(chooseMatrixCell({ toolchain: ["1.70", "stable", "beta", "nightly"] })?.cell, { toolchain: "stable" });
  assert.deepEqual(chooseMatrixCell({ go: ["1.21.x", "1.22.x"], include: [{ go: "1.22.x", race: true }] })?.cell, { go: "1.22.x", race: true });
  assert.deepEqual(chooseMatrixCell({ include: [{ name: "a", python: "3.9" }, { name: "b", python: "3.12" }] })?.cell, { name: "b", python: "3.12" });
  assert.deepEqual(chooseMatrixCell({ py: ["3.11", "3.12"], include: [{ py: "3.13", extra: "x" }] })?.cell, { py: "3.13", extra: "x" }, "an unmatched include is a cell of its own");
  assert.deepEqual(chooseMatrixCell(undefined), { cell: {}, cells: 1 });
  assert.equal(chooseMatrixCell("${{ fromJSON(needs.setup.outputs.matrix) }}"), null);
  assert.equal(chooseMatrixCell({ python: "${{ fromJSON(x) }}" }), null);
  assert.deepEqual(chooseMatrixCell({ a: [1], exclude: [{ a: 1 }] }), { cell: {}, cells: 0 });
});

test("classifyRunsOn keeps only hosted ubuntu", () => {
  assert.equal(classifyRunsOn(["ubuntu-latest"]), "ubuntu");
  assert.equal(classifyRunsOn(["ubuntu-24.04-arm"]), "ubuntu");
  assert.equal(classifyRunsOn(["macos-14"]), "non_linux");
  assert.equal(classifyRunsOn(["windows-2022"]), "non_linux");
  assert.equal(classifyRunsOn(["self-hosted", "linux", "gpu"]), "needs_gpu");
  assert.equal(classifyRunsOn(["self-hosted", "ubuntu"]), "self_hosted");
  assert.equal(classifyRunsOn(["blacksmith-4vcpu"]), "self_hosted");
});

test("normalizeVersion and versionFromFile speak mise", () => {
  assert.equal(normalizeVersion("3.x"), "3");
  assert.equal(normalizeVersion("18.x"), "18");
  assert.equal(normalizeVersion("lts/*"), "lts");
  assert.equal(normalizeVersion("v20.1.0"), "20.1.0");
  assert.equal(normalizeVersion("3.9\n3.12\n"), "3.12", "setup-python's last line is the default");
  assert.equal(normalizeVersion(""), "");
  assert.equal(versionFromFile("go.mod", "module x\n\ngo 1.22.1\n\ntoolchain go1.23.4\n"), "1.23.4");
  assert.equal(versionFromFile("go.mod", "module x\ngo 1.21\n"), "1.21");
  assert.equal(versionFromFile(".nvmrc", "v20.11.0\n"), "v20.11.0");
  assert.equal(versionFromFile(".python-version", "# pinned\n3.12\n"), "3.12");
  assert.equal(versionFromFile("pyproject.toml", '[project]\nrequires-python = ">=3.10"\n'), "latest");
  assert.equal(versionFromFile("pyproject.toml", '[project]\nrequires-python = "==3.11.*"\n'), "3.11");
  assert.equal(versionFromFile("package.json", '{"engines":{"node":">=18.12"}}'), "18.12");
  assert.equal(versionFromFile("package.json", "not json"), null);
  assert.equal(versionFromFile(".nvmrc", ""), null);
});

test("isTestScript / isLintScript tell installs, tests and linters apart", () => {
  for (const s of ["pytest -q", "python -m pytest tests", "uv run pytest", "tox -e py", "npm test", "yarn test:unit", "pnpm run test", "go test ./...", "cargo test --all", "./gradlew check", "./mvnw -B verify", "bundle exec rake", "make test", "python runtests.py", "npx vitest run", "pip install -e .\npytest"]) {
    assert.ok(isTestScript(s), s);
  }
  for (const s of ["pip install pytest tox", "npm ci", "go mod download", "echo test", "uv sync --group test", "cargo build"]) assert.ok(!isTestScript(s), s);
  for (const s of ["ruff check .", "npx eslint .", "pre-commit run --all-files", "cargo clippy -- -D warnings", "npm run lint"]) assert.ok(isLintScript(s), s);
  assert.ok(!isLintScript("ruff check . && pytest"), "a step that also tests is a test step");
});

test("stepCommand isolates each step and runs under the right shell (executed)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opensrcer-step-"));
  const sh = (cmd: string) => execFileSync("bash", ["-c", `set -e\n${cmd}`], { cwd: dir, encoding: "utf8" }).replace(/\r/g, "");
  try {
    execFileSync("bash", ["-c", "mkdir -p sub"], { cwd: dir });
    assert.equal(stepCommand("echo hi", {}), "echo hi");
    assert.equal(stepCommand("cd sub && pwd", {}), "(cd sub && pwd)", "a cd does not leak into later steps");
    assert.match(sh(`${stepCommand("pwd", { workingDirectory: "sub" })}\npwd`), /\/sub\n.*[^b]\n$/);
    assert.equal(sh(stepCommand("echo \"$A-$B\"", { env: { A: "it's", B: "x y" } })), "it's-x y\n");
    const multi = stepCommand("        x=1\n        echo $((x + 1))\n        false || echo recovered\n", { shell: "bash" });
    assert.match(multi, /^bash --noprofile --norc -eo pipefail -c /);
    assert.equal(sh(multi), "2\nrecovered\n");
    assert.throws(() => sh(stepCommand("false\necho never", {})), "bash -e stops at the first failure");
    assert.equal(sh(stepCommand("echo from sh", { shell: "sh", workingDirectory: "sub" })), "from sh\n");
    assert.equal(sh(stepCommand("echo custom", { shell: "bash -e {0}" })), "custom\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Synthetic workflows for each rule of §5.2 step 3 ─────────────────────

const wf = (yaml: string, extra: Record<string, string> = {}) => ({ repo: "acme/widget", files: { ".github/workflows/ci.yml": yaml, ...extra } });

test("compileCi: setup actions, matrix and env expressions, skipped actions, test vs setup vs lint", async () => {
  const r = await compileCi(wf(`
name: CI
on: [push, pull_request]
env:
  FORCE_COLOR: "1"
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: ruff check .
  tests:
    runs-on: \${{ matrix.os }}
    timeout-minutes: 20
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        python-version: ["3.11", "3.13"]
    env:
      PYV: py\${{ matrix.python-version }}
      TOKEN: \${{ secrets.API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
      - uses: actions/cache@v4
        with: { path: ~/.cache }
      - run: pip install -e .[test]
      - run: ruff format --check .
      - name: Run tests
        run: |
          pytest -n auto --cov
      - uses: codecov/codecov-action@v5
      - run: coverage report
`));
  assert.equal(r.job, "tests");
  assert.equal(r.partial, false, r.notes.join("\n"));
  assert.deepEqual(r.recipe, {
    repo: "acme/widget", source: "ci", runtimes: { python: "3.13" }, services: [],
    env: { FORCE_COLOR: "1", PYV: "py3.13" },
    setup: ["pip install -e .[test]"], test: ["pytest -n auto --cov"], lint: ["ruff format --check ."],
    timeouts: { setupMs: 15 * 60_000, testMs: 20 * 60_000 },
  });
  assert.ok(r.notes.some((n) => /env TOKEN needs a secret/.test(n)));
  assert.ok(r.notes.some((n) => /dropped "coverage report": runs after the tests/.test(n)), r.notes.join("\n"));
});

test("compileCi: secrets in a test step make the recipe partial; elsewhere the step is skipped", async () => {
  const r = await compileCi(wf(`
on: pull_request
jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - run: ./login.sh
        env: { PASS: "\${{ secrets.REGISTRY_PASS }}" }
      - run: npm ci
      - run: npm test
        env:
          API_KEY: \${{ secrets.API_KEY }}
          MODE: ci
`));
  assert.equal(r.partial, true);
  assert.deepEqual(r.recipe?.setup, ["npm ci"]);
  assert.deepEqual(r.recipe?.test, ["MODE='ci' bash -e -c 'npm test'"]);
  assert.ok(r.notes.some((n) => /skipped "\.\/login\.sh": needs secrets REGISTRY_PASS/.test(n)), r.notes.join("\n"));
  assert.ok(r.notes.some((n) => /test step "npm test" needs secrets API_KEY/.test(n)));
});

test("compileCi: if: on github.repository holds; other conditions are evaluated for a pull_request", async () => {
  const r = await compileCi(wf(`
on: [push, pull_request]
jobs:
  test:
    if: github.repository == 'upstream/widget'
    runs-on: ubuntu-latest
    steps:
      - run: touch only-on-push
        if: github.event_name == 'push'
      - run: touch upstream-only
        if: \${{ github.repository_owner == 'upstream' && success() }}
      - run: touch fork-only
        if: github.repository != 'upstream/widget'
      - run: make test
`));
  assert.deepEqual(r.recipe?.setup, ["touch upstream-only"]);
  assert.deepEqual(r.recipe?.test, ["make test"]);
});

test("compileCi: local composite actions are inlined with their inputs; unknown actions are recorded", async () => {
  const r = await compileCi(wf(`
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup
        with: { extras: "test,dev" }
      - uses: someone/install-tool@v3
        with: { tool: nextest }
      - run: cargo nextest run
`, {
    ".github/actions/setup/action.yml": `
name: setup
inputs:
  extras: { description: x, default: "test" }
  venv: { description: y, default: ".venv" }
runs:
  using: composite
  steps:
    - uses: actions/setup-python@v5
      with: { python-version-file: .python-version }
    - run: python -m venv \${{ inputs.venv }} && .venv/bin/pip install -e '.[\${{ inputs.extras }}]'
      shell: bash
`,
    ".python-version": "3.12\n",
  }));
  assert.deepEqual(r.recipe?.runtimes, { python: "3.12" });
  assert.deepEqual(r.recipe?.setup, ["python -m venv .venv && .venv/bin/pip install -e '.[test,dev]'"]);
  assert.deepEqual(r.unknownActions, [{ uses: "someone/install-tool@v3", step: "someone/install-tool@v3", with: { tool: "nextest" } }]);
  assert.equal(r.partial, true, "an unknown action ran before the tests");
});

test("compileCi: services become service specs; reusable local workflows are expanded with their inputs", async () => {
  const r = await compileCi({
    repo: "acme/widget",
    files: {
      ".github/workflows/ci.yml": `
on: pull_request
jobs:
  call:
    uses: ./.github/workflows/test.yml
    with: { node: "20" }
    secrets: inherit
  remote:
    uses: octo/shared/.github/workflows/lint.yml@main
`,
      ".github/workflows/test.yml": `
on:
  workflow_call:
    inputs:
      node: { type: string, default: "18" }
      cmd: { type: string, default: "npm test" }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, SECRET: "\${{ secrets.X }}" }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready
      redis:
        image: redis
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: "\${{ inputs.node }}" }
      - run: npm ci
      - run: \${{ inputs.cmd }}
        working-directory: packages/core
`,
    },
  });
  assert.equal(r.workflow, ".github/workflows/test.yml");
  assert.deepEqual(r.recipe?.runtimes, { node: "20" });
  assert.deepEqual(r.recipe?.services, [{ name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "postgres" }, ports: [5432] }, { name: "redis", image: "redis" }]);
  assert.deepEqual(r.recipe?.test, ["(cd 'packages/core' && npm test)"]);
  assert.ok(r.notes.some((n) => /reusable workflow octo\/shared/.test(n)));
});

test("compileCi: unreachable when the tests only run off Linux, or nothing tests", async () => {
  const mac = await compileCi(wf(`
on: push
jobs:
  test:
    runs-on: macos-latest
    steps: [{ run: swift test }, { run: xcodebuild test }]
  docs:
    runs-on: ubuntu-latest
    steps: [{ run: make docs }]
`));
  assert.equal(mac.recipe, null);
  assert.equal(mac.unreachable, "non_linux");
  const gpu = await compileCi(wf(`
on: push
jobs:
  test:
    runs-on: [self-hosted, gpu]
    steps: [{ run: pytest }]
`));
  assert.equal(gpu.unreachable, "needs_gpu");
  const none = await compileCi(wf(`
on: { schedule: [{ cron: "0 0 * * *" }] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [{ run: pytest }]
`));
  assert.equal(none.unreachable, "no_tests");
  assert.equal((await compileCi({ repo: "a/b", files: {} })).unreachable, "no_tests");
  const broken = await compileCi(wf("on: push\njobs: [not, a, mapping\n"));
  assert.equal(broken.unreachable, "no_tests");
  assert.ok(broken.notes.some((n) => /schema error/.test(n)));
});

test("compileCi: a matrix computed at run time and a guessed test step are partial", async () => {
  const r = await compileCi(wf(`
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix: \${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - run: ./ci/install.sh
      - run: ./ci/run-suite.sh \${{ matrix.suite }}
`));
  assert.equal(r.partial, true);
  assert.deepEqual(r.recipe?.setup, ["./ci/install.sh"]);
  assert.deepEqual(r.recipe?.test, ["./ci/run-suite.sh"]);
  assert.ok(r.notes.some((n) => /partial: the job's matrix is computed at run time/.test(n)));
  assert.ok(r.notes.some((n) => /partial: no step names a known test runner/.test(n)));
});
