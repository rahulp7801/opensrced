// The fast loop (PLAN.md §5.7): run only the tests related to a change,
// with each ecosystem's native selection where it has one
// (jest --findRelatedTests, vitest related, go/cargo packages) and pytest
// files picked by path convention or a graph impact list. The full suite
// still runs once per fix and in fork CI.

import path from "node:path";
import type { EnvRecipe, RelatedKind } from "./recipe";

type Related = NonNullable<EnvRecipe["testRelated"]>;

/** Which related-test selection fits the recipe's test commands, with the
 *  command template (`{targets}` is filled in later). Null when none fits. */
export function inferTestRelated(test: string[], packageJson?: string | null): Related | null {
  const all = test.join("\n");
  const deps = packageJson ?? "";
  const line = all.split("\n").find((l) => /\bpytest\b/.test(l));
  if (line) {
    // Keep the runner prefix the repository uses (uv run, hatch run,
    // python -m, coverage run -m), cut at the enclosing shell syntax.
    const prefix = line.slice(0, line.search(/\bpytest\b/)).split(/&&|;|'|\(|\|/).pop()!.trim();
    return { kind: "pytest-files", template: `${prefix ? `${prefix} ` : ""}pytest {targets}` };
  }
  if (/\bvitest\b/.test(all) || /"vitest"\s*:/.test(deps)) return { kind: "vitest", template: "npx vitest related --run {targets}" };
  if (/\bjest\b/.test(all) || /"jest"\s*:/.test(deps)) return { kind: "jest", template: "npx jest --findRelatedTests {targets} --passWithNoTests" };
  if (/\bgo\s+test\b/.test(all)) return { kind: "go-pkg", template: "go test {targets}" };
  if (/\bcargo\s+(?:test|nextest)\b/.test(all)) return { kind: "cargo-pkg", template: "cargo test {targets}" };
  if (/\b(?:python3?|py\.test|tox|nox)\b/.test(all)) return { kind: "pytest-files", template: "python -m pytest {targets}" };
  return null;
}

const shellQuote = (s: string) => (/^[\w./:@=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

const JS = /\.[cm]?[jt]sx?$/;

/** Candidate test files for a Python source file, by the layouts pytest
 *  projects use: tests/test_x.py, tests/<pkg path>/test_x.py, a sibling
 *  tests/ directory, and x_test.py next to it. */
function pytestCandidates(file: string): string[] {
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file, ".py");
  const parts = dir === "." ? [] : dir.split("/").filter((p) => p !== "src");
  const out = [
    `tests/test_${base}.py`,
    `test/test_${base}.py`,
    `${dir}/tests/test_${base}.py`,
    `${dir}/test_${base}.py`,
    `${dir}/${base}_test.py`,
  ];
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(i).join("/");
    out.push(`tests/${sub ? `${sub}/` : ""}test_${base}.py`);
  }
  return out.map((p) => p.replace(/^\.\//, ""));
}

const isPyTest = (f: string) => /(^|\/)test_[^/]*\.py$|_test\.py$/.test(f);

/** The crate name of the nearest Cargo.toml above `file`. */
function crateOf(file: string, read: (p: string) => string | null): string | null {
  let dir = path.posix.dirname(file);
  for (;;) {
    const manifest = read(dir === "." ? "Cargo.toml" : `${dir}/Cargo.toml`);
    const name = manifest ? /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms.exec(manifest)?.[1] : null;
    if (name) return name;
    if (dir === "." || dir === "") return null;
    dir = path.posix.dirname(dir);
  }
}

export type RelatedInput = {
  /** Files the change touches, repository-relative. */
  changed: string[];
  /** Files that exist in the checkout (for pytest candidates). */
  exists: (p: string) => boolean;
  /** Reads a repository file (Cargo.toml for crate names). */
  read?: (p: string) => string | null;
  /** Test files a graph impact analysis tied to the change (analyzeImpactFromDiff). */
  impact?: string[];
};

/** The related-test command for a change, or null when nothing selects. */
export function relatedTestCommand(related: Related, input: RelatedInput): string | null {
  const changed = [...new Set(input.changed.map((f) => f.replace(/\\/g, "/")))];
  let targets: string[] = [];
  const kind: RelatedKind = related.kind;
  if (kind === "jest" || kind === "vitest") targets = changed.filter((f) => JS.test(f));
  else if (kind === "go-pkg") targets = [...new Set(changed.filter((f) => f.endsWith(".go")).map((f) => `./${path.posix.dirname(f)}`.replace(/^\.\/\.$/, ".")))];
  else if (kind === "cargo-pkg") {
    const read = input.read ?? (() => null);
    targets = [...new Set(changed.filter((f) => f.endsWith(".rs")).map((f) => crateOf(f, read)).filter((c): c is string => Boolean(c)))].map((c) => `-p ${c}`);
  } else {
    const picked = new Set<string>();
    for (const f of changed) {
      if (!f.endsWith(".py")) continue;
      if (isPyTest(f)) picked.add(f);
      else for (const c of pytestCandidates(f)) if (input.exists(c)) picked.add(c);
    }
    for (const f of input.impact ?? []) if (isPyTest(f) && input.exists(f)) picked.add(f);
    targets = [...picked].sort();
  }
  if (!targets.length) return null;
  const rendered = kind === "cargo-pkg" ? targets.join(" ") : targets.map(shellQuote).join(" ");
  return related.template.replace("{targets}", rendered);
}
