import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTestRelated, relatedTestCommand } from "../env/related-tests";

test("inferTestRelated picks the runner from the recipe's test commands", () => {
  const cases: [string[], string | null, ReturnType<typeof inferTestRelated>][] = [
    [["uv run --frozen pytest -n auto"], null, { kind: "pytest-files", template: "uv run --frozen pytest {targets}" }],
    [["(cd src && python -m pytest tests)"], null, { kind: "pytest-files", template: "python -m pytest {targets}" }],
    [["bash -e -c 'coverage run -m pytest -v'"], null, { kind: "pytest-files", template: "coverage run -m pytest {targets}" }],
    [["pytest"], null, { kind: "pytest-files", template: "pytest {targets}" }],
    [["pnpm test"], `{"devDependencies":{"vitest":"^3"}}`, { kind: "vitest", template: "npx vitest related --run {targets}" }],
    [["npx jest --ci"], null, { kind: "jest", template: "npx jest --findRelatedTests {targets} --passWithNoTests" }],
    [["npm test"], `{"devDependencies":{"jest":"29"}}`, { kind: "jest", template: "npx jest --findRelatedTests {targets} --passWithNoTests" }],
    [["go test -race ./..."], null, { kind: "go-pkg", template: "go test {targets}" }],
    [["cargo test --all-features"], null, { kind: "cargo-pkg", template: "cargo test {targets}" }],
    [["uvx tox -e py"], null, { kind: "pytest-files", template: "python -m pytest {targets}" }],
    [["npm test"], `{"devDependencies":{"mocha":"10"}}`, null],
    [["./gradlew test"], null, null],
    [[], null, null],
  ];
  for (const [testCmds, pkg, want] of cases) assert.deepEqual(inferTestRelated(testCmds, pkg), want, testCmds.join(" | "));
});

const files = new Set(["tests/test_parser.py", "tests/utils/test_text.py", "pkg/sub/tests/test_mod.py", "src/lib/a_test.py", "tests/test_other.py"]);
const exists = (p: string) => files.has(p);

test("pytest-files: changed tests, convention-matched tests and impact-listed tests", () => {
  const related = { kind: "pytest-files" as const, template: "python -m pytest {targets} -q" };
  assert.equal(
    relatedTestCommand(related, { changed: ["src/mypkg/parser.py", "mypkg/utils/text.py", "pkg/sub/mod.py", "README.md"], exists }),
    "python -m pytest pkg/sub/tests/test_mod.py tests/test_parser.py tests/utils/test_text.py -q",
  );
  assert.equal(relatedTestCommand(related, { changed: ["tests/test_new.py"], exists }), "python -m pytest tests/test_new.py -q", "a changed test file is selected even if new");
  assert.equal(relatedTestCommand(related, { changed: ["src/zzz.py"], exists, impact: ["tests/test_other.py", "docs/x.md", "tests/missing_test.py"] }), "python -m pytest tests/test_other.py -q");
  assert.equal(relatedTestCommand(related, { changed: ["src/zzz.py", "docs/a.md"], exists }), null, "nothing related: no command");
  assert.equal(relatedTestCommand(related, { changed: [], exists }), null);
  assert.equal(relatedTestCommand(related, { changed: ["src\\lib\\a.py"], exists }), "python -m pytest src/lib/a_test.py -q", "windows separators");
});

test("jest/vitest pass changed JS/TS files, quoted when needed", () => {
  const jest = { kind: "jest" as const, template: "npx jest --findRelatedTests {targets}" };
  assert.equal(relatedTestCommand(jest, { changed: ["src/a.ts", "src/my file.tsx", "README.md", "lib/x.mjs"], exists }), "npx jest --findRelatedTests src/a.ts 'src/my file.tsx' lib/x.mjs");
  assert.equal(relatedTestCommand({ kind: "vitest", template: "npx vitest related --run {targets}" }, { changed: ["docs/a.md"], exists }), null);
});

test("go-pkg selects package directories once; cargo-pkg selects crates by nearest Cargo.toml", () => {
  assert.equal(relatedTestCommand({ kind: "go-pkg", template: "go test {targets}" }, { changed: ["mux.go", "middleware/a.go", "middleware/b_test.go", "go.mod"], exists }), "go test . ./middleware");
  const manifests: Record<string, string> = {
    "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\n",
    "crates/core/Cargo.toml": "[package]\nname = \"grep-core\"\nversion = \"1.0.0\"\n\n[dependencies]\nname = \"not-this\"\n",
    "crates/cli/Cargo.toml": "[package]\nversion = \"0.1.0\"\nname = \"grep-cli\"\n",
  };
  const read = (p: string) => manifests[p] ?? null;
  const cargo = { kind: "cargo-pkg" as const, template: "cargo test {targets}" };
  assert.equal(relatedTestCommand(cargo, { changed: ["crates/core/src/lib.rs", "crates/core/src/x/y.rs", "crates/cli/src/main.rs"], exists, read }), "cargo test -p grep-core -p grep-cli");
  assert.equal(relatedTestCommand(cargo, { changed: ["build.rs"], exists, read }), null, "a workspace root has no package");
  assert.equal(relatedTestCommand(cargo, { changed: ["crates/core/src/lib.rs"], exists }), null, "no reader: no crate names");
});
