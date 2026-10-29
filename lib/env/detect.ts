// Environment detection (PLAN.md §5.2): deterministic layers first, the
// agent last.
//
//   1. builtin       hand-written plans (vllm, react; pytorch is left to the agent)
//   2. devcontainer  detected and described; running it is a later step (1.5)
//   3. ci            .github/workflows compiled by lib/env/ci-compile.ts
//   4. mise          runtimes from version files and manifest fields CI did not pin
//   5. lockfile      the widened setupPlan heuristics, per ecosystem
//   6. railpack      described only (`railpack plan` is not in the image yet)
//   7. agent         nothing deterministic worked: the agent sets up (marker)
//
// detectRecipe is pure over a map of file contents; readRecipeFiles reads
// that map from a checkout (no symlinks, size-capped), and its hash is the
// recipe_hash of §5.4.

import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { builtinSetup, readDoc } from "../contrib-profile";
import { compileCi, type Unreachable, type UnknownAction } from "./ci-compile";
import { DEFAULT_TIMEOUTS, recipeHash, type EnvRecipe, type RecipeSource } from "./recipe";
import { inferTestRelated } from "./related-tests";

export type RepoFiles = Record<string, string>;

export type Detection = {
  recipe: EnvRecipe;
  /** recipe_hash of the files detection read. */
  hash: string;
  notes: string[];
  /** CI says the tests cannot run on a Linux VM (or there are none). */
  unreachable?: Unreachable;
  partial: boolean;
  unknownActions: UnknownAction[];
};

/** Files read from a checkout's root, besides the workflow and action
 *  directories: devcontainer, version files, manifests and lockfiles. */
const ROOT_FILES = [
  ".devcontainer.json", ".devcontainer/devcontainer.json",
  ".nvmrc", ".node-version", ".python-version", ".tool-versions", ".ruby-version", ".java-version", ".go-version",
  "rust-toolchain", "rust-toolchain.toml", "mise.toml", ".mise.toml",
  "package.json", "package-lock.json", "yarn.lock", ".yarnrc.yml", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "requirements-dev.txt", "requirements-test.txt",
  "poetry.lock", "pdm.lock", "uv.lock", "tox.ini", "noxfile.py",
  "go.mod", "go.sum", "Cargo.toml", "Cargo.lock",
  "pom.xml", "mvnw", "build.gradle", "build.gradle.kts", "gradlew",
  "Gemfile", "Gemfile.lock", ".rspec", "composer.json", "composer.lock", "Makefile",
];

const MAX_FILE_BYTES = 50_000_000;

function listDir(dir: string, rel: string): string[] {
  try {
    const abs = path.join(dir, rel);
    if (lstatSync(abs).isSymbolicLink()) return [];
    return readdirSync(abs).sort();
  } catch {
    return [];
  }
}

/** The files detection looks at, read from a checkout. */
export function readRecipeFiles(dir: string): RepoFiles {
  const rels = [...ROOT_FILES];
  for (const f of listDir(dir, ".github/workflows")) if (/\.ya?ml$/.test(f)) rels.push(`.github/workflows/${f}`);
  for (const a of listDir(dir, ".github/actions")) rels.push(`.github/actions/${a}/action.yml`, `.github/actions/${a}/action.yaml`);
  for (const d of listDir(dir, ".devcontainer")) rels.push(`.devcontainer/${d}/devcontainer.json`);
  const files: RepoFiles = {};
  for (const rel of rels) {
    const content = readDoc(dir, rel, MAX_FILE_BYTES);
    if (content !== null) files[rel] = content;
  }
  return files;
}

// ── mise: version files ───────────────────────────────────────────────────

/** A version from a range: exact pins and caret/tilde give their version,
 *  `>=X,<Y` its lower bound, an open `>=X` the newest release. */
export function versionFromRange(spec: string): string | null {
  const s = spec.trim().replace(/^["']|["']$/g, "");
  const lower = /(?:>=|>)\s*v?(\d+(?:\.\d+)*)/.exec(s)?.[1];
  if (lower) return /</.test(s) ? lower : "latest";
  const exact = /^(?:==|~=|\^|~|=)?\s*v?(\d+(?:\.\d+)*)/.exec(s)?.[1];
  return exact ?? null;
}

const MISE_NAMES: Record<string, string> = { nodejs: "node", golang: "go", python: "python", ruby: "ruby", java: "java", rust: "rust" };

/** Runtimes the repository pins outside CI (§5.2 step 4). */
export function miseRuntimes(files: RepoFiles): Record<string, string> {
  const out: Record<string, string> = {};
  const first = (f: string) => files[f]?.split("\n").map((l) => l.replace(/#.*/, "").trim()).find(Boolean);
  const set = (tool: string, v: string | null | undefined) => {
    if (v && !out[tool]) out[tool] = v.replace(/^v(?=\d)/, "");
  };
  for (const line of (files[".tool-versions"] ?? "").split("\n")) {
    const [tool, version] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (tool && version) set(MISE_NAMES[tool] ?? tool, version);
  }
  set("node", first(".nvmrc") ?? first(".node-version"));
  set("python", first(".python-version"));
  set("ruby", first(".ruby-version")?.replace(/^ruby-/, ""));
  set("java", first(".java-version"));
  set("go", first(".go-version"));
  const toolchain = files["rust-toolchain.toml"] ? /^channel\s*=\s*"([^"]+)"/m.exec(files["rust-toolchain.toml"])?.[1] : first("rust-toolchain");
  set("rust", toolchain);
  if (files["go.mod"]) set("go", /^toolchain\s+go(\S+)/m.exec(files["go.mod"])?.[1] ?? /^go\s+(\S+)/m.exec(files["go.mod"])?.[1]);
  if (files["package.json"]) {
    try {
      const pkg = JSON.parse(files["package.json"]) as { engines?: { node?: string }; packageManager?: string };
      if (pkg.engines?.node) set("node", versionFromRange(pkg.engines.node));
      const pm = /^(pnpm|yarn|bun)@([^+]+)/.exec(pkg.packageManager ?? "");
      if (pm && pm[1] !== "yarn") set(pm[1], pm[2]);
    } catch {
      // not JSON: nothing to read
    }
  }
  const requires = files["pyproject.toml"] ? /^requires-python\s*=\s*["']([^"']+)["']/m.exec(files["pyproject.toml"])?.[1] : undefined;
  if (requires) set("python", versionFromRange(requires));
  return out;
}

// ── lockfile heuristics ───────────────────────────────────────────────────

type Plan = { setup: string[]; test: string[]; note: string };

/** Present, even when empty (an empty lockfile still names the tool). */
const has = (files: RepoFiles, f: string) => files[f] !== undefined;

const VENV = "~/env/venv";

/** Extras worth installing for tests, when pyproject declares them. */
function pythonExtras(pyproject: string): string[] {
  const section = /^\[project\.optional-dependencies\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(pyproject)?.[1] ?? "";
  const declared = [...section.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]);
  return ["test", "tests", "testing", "dev"].filter((e) => declared.includes(e));
}

function pythonPlan(files: RepoFiles): Plan | null {
  const py = files["pyproject.toml"] ?? "";
  if (has(files, "uv.lock")) return { setup: ["uv sync"], test: ["uv run pytest"], note: "uv.lock" };
  if (has(files, "poetry.lock") || /^\[tool\.poetry\]/m.test(py)) return { setup: ["uvx poetry install"], test: ["uvx poetry run pytest"], note: "poetry" };
  if (has(files, "pdm.lock") || /^\[tool\.pdm\]/m.test(py)) return { setup: ["uvx pdm install"], test: ["uvx pdm run pytest"], note: "pdm" };
  if (has(files, "tox.ini") || /^\[tool\.tox\]/m.test(py)) return { setup: [], test: ["uvx tox -e py"], note: "tox" };
  if (has(files, "noxfile.py")) return { setup: [], test: ["uvx nox -s tests"], note: "nox" };
  if (/^\[tool\.hatch/m.test(py)) return { setup: [], test: ["uvx hatch test"], note: "hatch" };
  const venv = `[ -x ${VENV}/bin/python ] || python3 -m venv ${VENV}`;
  if (has(files, "pyproject.toml") || has(files, "setup.py") || has(files, "setup.cfg")) {
    const extras = pythonExtras(py);
    const target = extras.length ? `'.[${extras.join(",")}]'` : ".";
    return { setup: [venv, `${VENV}/bin/pip install -e ${target} pytest`], test: [`${VENV}/bin/python -m pytest`], note: `pip -e ${target}` };
  }
  const reqs = ["requirements.txt", "requirements-dev.txt", "requirements-test.txt"].filter((f) => files[f] !== undefined);
  if (reqs.length) return { setup: [venv, `${VENV}/bin/pip install ${reqs.map((r) => `-r ${r}`).join(" ")} pytest`], test: [`${VENV}/bin/python -m pytest`], note: reqs.join(" + ") };
  return null;
}

function jsPlan(files: RepoFiles): Plan | null {
  if (!has(files, "package.json")) return null;
  let pkg: { scripts?: Record<string, string>; packageManager?: string } = {};
  try {
    pkg = JSON.parse(files["package.json"]);
  } catch {
    return null;
  }
  const hasTest = Boolean(pkg.scripts?.test) && !/no test specified/.test(pkg.scripts?.test ?? "");
  const pm = /^(\w+)@([^+]+)/.exec(pkg.packageManager ?? "");
  const pin = (tool: string) => (pm?.[1] === tool ? `@${pm[2]}` : "");
  const ensure = (tool: string) => `command -v ${tool} >/dev/null || npm install -g ${tool}${pin(tool)}`;
  if (has(files, "pnpm-lock.yaml")) return { setup: [ensure("pnpm"), "pnpm install --frozen-lockfile"], test: hasTest ? ["pnpm test"] : [], note: "pnpm" };
  if (has(files, "bun.lock") || has(files, "bun.lockb")) return { setup: [ensure("bun"), "bun install --frozen-lockfile"], test: hasTest ? ["bun run test"] : [], note: "bun" };
  if (has(files, "yarn.lock")) {
    const berry = files[".yarnrc.yml"] !== undefined;
    return { setup: berry ? ["corepack enable", "yarn install --immutable"] : ["yarn install --frozen-lockfile --ignore-engines"], test: hasTest ? ["yarn test"] : [], note: berry ? "yarn berry" : "yarn" };
  }
  if (has(files, "package-lock.json")) return { setup: ["npm ci --no-audit --no-fund"], test: hasTest ? ["npm test"] : [], note: "npm" };
  return { setup: ["npm install --no-audit --no-fund"], test: hasTest ? ["npm test"] : [], note: "npm (no lockfile)" };
}

/** Widened lockfile heuristics (§5.2 step 5), first match wins. Compiled
 *  ecosystems first: a Go or Rust repository often carries a package.json
 *  for its website, a Python one for its docs tooling. */
export function lockfilePlan(files: RepoFiles): Plan | null {
  if (has(files, "go.mod")) return { setup: ["go mod download"], test: ["go test ./..."], note: "go.mod" };
  if (has(files, "Cargo.toml")) return { setup: ["cargo fetch"], test: ["cargo test"], note: "Cargo.toml" };
  if (has(files, "mvnw") || has(files, "pom.xml")) return { setup: [], test: [has(files, "mvnw") ? "./mvnw -B test" : "mvn -B test"], note: "maven" };
  if (has(files, "gradlew") || has(files, "build.gradle") || has(files, "build.gradle.kts")) return { setup: [], test: [has(files, "gradlew") ? "./gradlew test" : "gradle test"], note: "gradle" };
  if (has(files, "Gemfile")) {
    const rspec = files[".rspec"] !== undefined || /\brspec\b/.test(files["Gemfile"]);
    return { setup: ["bundle install"], test: [rspec ? "bundle exec rspec" : "bundle exec rake"], note: "bundler" };
  }
  if (has(files, "composer.json")) return { setup: ["composer install --no-interaction --prefer-dist"], test: ["vendor/bin/phpunit"], note: "composer" };
  const python = pythonPlan(files);
  if (python) return python;
  const js = jsPlan(files);
  if (js) return js;
  if (files["Makefile"] && /^test\s*:/m.test(files["Makefile"])) return { setup: [], test: ["make test"], note: "Makefile test target" };
  return null;
}

// ── Detection ─────────────────────────────────────────────────────────────

const empty = (repo: string, source: RecipeSource): EnvRecipe => ({
  repo, source, runtimes: {}, services: [], env: {}, setup: [], test: [], lint: [], timeouts: { ...DEFAULT_TIMEOUTS },
});

/** Run the detection layers over a checkout's files. */
export async function detectRecipe(repo: string, files: RepoFiles, opts: { defaultBranch?: string } = {}): Promise<Detection> {
  const hash = recipeHash(files);
  const notes: string[] = [];
  const done = (recipe: EnvRecipe, extra: Partial<Detection> = {}): Detection => {
    const related = recipe.testRelated ?? inferTestRelated(recipe.test, files["package.json"]);
    return { recipe: related ? { ...recipe, testRelated: related } : recipe, hash, notes, partial: false, unknownActions: [], ...extra };
  };

  // 1. builtin
  const builtin = builtinSetup(repo);
  if (builtin !== undefined) {
    notes.push(builtin ? "builtin: hand-written setup for this repository" : "builtin: setup is left to the agent for this repository");
    return done({ ...empty(repo, "builtin"), setup: builtin?.commands ?? [] });
  }

  // 2. devcontainer: described, not run yet.
  const devcontainer = [".devcontainer/devcontainer.json", ".devcontainer.json", ...Object.keys(files).filter((f) => /^\.devcontainer\/[^/]+\/devcontainer\.json$/.test(f)).sort()]
    .find((f) => files[f] !== undefined);
  if (devcontainer) notes.push(`devcontainer: ${devcontainer} found; not run yet (lib/env/devcontainer.ts), installing on the base image instead`);
  const withDevcontainer = (r: EnvRecipe): EnvRecipe => (devcontainer ? { ...r, devcontainer: { path: devcontainer } } : r);

  // 3. ci
  const ci = await compileCi({ repo, files, defaultBranch: opts.defaultBranch });
  notes.push(...ci.notes);
  const runtimes = miseRuntimes(files);
  if (ci.recipe) {
    // 4. mise fills runtimes CI did not pin.
    const recipe = { ...ci.recipe, runtimes: { ...runtimes, ...ci.recipe.runtimes } };
    return done(withDevcontainer(recipe), { partial: ci.partial, unknownActions: ci.unknownActions });
  }
  const reach = ci.unreachable && ci.unreachable !== "no_tests" ? { unreachable: ci.unreachable } : {};
  if (ci.unreachable && ci.unreachable !== "no_tests") notes.push(`ci: unreachable (${ci.unreachable}); falling back to the lockfile heuristics`);

  // 5. lockfile (with 4's runtimes)
  const plan = lockfilePlan(files);
  if (plan && plan.test.length) {
    notes.push(`lockfile: ${plan.note}`);
    return done(withDevcontainer({ ...empty(repo, "lockfile"), runtimes, setup: plan.setup, test: plan.test }), reach);
  }

  // 6. railpack: describe only.
  notes.push("railpack: `railpack plan` would be tried here; not in the image yet");

  // Devcontainer or version files alone still say something.
  if (devcontainer) return done({ ...empty(repo, "devcontainer"), runtimes, setup: plan?.setup ?? [], devcontainer: { path: devcontainer } }, reach);
  if (Object.keys(runtimes).length || plan) return done({ ...empty(repo, plan ? "lockfile" : "mise"), runtimes, setup: plan?.setup ?? [] }, { ...reach, partial: true });

  // 7. agent
  notes.push("agent: nothing deterministic found; the agent sets up the environment");
  return done(empty(repo, "agent"), reach);
}
