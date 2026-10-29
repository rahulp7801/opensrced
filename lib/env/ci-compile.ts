// Compile a repository's GitHub Actions workflows into an EnvRecipe
// (PLAN.md §5.2 step 3): pick the job that runs the tests, choose one matrix
// cell, turn setup actions into runtimes, services into containers, and the
// job's `run:` steps into setup / test / lint commands.
//
// GitHub's own parsers do the reading: @actions/workflow-parser validates
// the YAML against the workflow (and action) schema and splits out
// `${{ }}` expressions, and @actions/expressions evaluates them the way the
// runner does (format(), fromJSON(), contains(), ...). This file is only the
// glue: which job, which cell, which step means what.
//
// Pure: the input is file contents keyed by repository path, the output is
// a recipe plus notes. Nothing here touches the network or a checkout.

import { registerHooks } from "node:module";
import type { TemplateToken } from "@actions/workflow-parser/templates/tokens/template-token";
import type * as Expressions from "@actions/expressions";
import { DEFAULT_TIMEOUTS, envQuote, type EnvRecipe, type ServiceSpec } from "./recipe";

type WorkflowParser = typeof import("@actions/workflow-parser");
type ActionParser = typeof import("@actions/workflow-parser/actions/action-parser");
type Libs = { wp: WorkflowParser; ap: ActionParser; ex: typeof Expressions };

// Loading them natively takes two workarounds:
// - Both are ES modules whose exports map has only an "import" condition, so
//   the require() that tsc's CommonJS output (the test and worker builds)
//   turns a plain import() into cannot load them. A Function-wrapped import()
//   survives compilation.
// - workflow-parser imports its JSON schemas without `with { type: "json" }`
//   (fine for bundlers, refused by Node). A resolve hook adds the attribute,
//   only for JSON imported from inside node_modules/@actions/.
const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
let libs: Promise<Libs> | null = null;
function loadLibs(): Promise<Libs> {
  libs ??= (() => {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (!resolved.url.endsWith(".json") || !(context.parentURL ?? "").includes("/node_modules/@actions/")) return resolved;
        return { ...resolved, importAttributes: { ...context.importAttributes, type: "json" } };
      },
    });
    return Promise.all([
    importEsm("@actions/workflow-parser") as Promise<WorkflowParser>,
    importEsm("@actions/workflow-parser/actions/action-parser") as Promise<ActionParser>,
    importEsm("@actions/expressions") as Promise<typeof Expressions>,
    ]).then(([wp, ap, ex]) => ({ wp, ap, ex }));
  })();
  return libs;
}

/** Why no recipe can be compiled for this repository's CI (§5.1, §5.9). */
export type Unreachable = "non_linux" | "needs_gpu" | "self_hosted" | "no_tests";

export type UnknownAction = { uses: string; step: string; with: Record<string, string> };

export type CompileResult = {
  recipe: EnvRecipe | null;
  notes: string[];
  unreachable?: Unreachable;
  /** Something the tests may need could not be carried over: a test step
   *  needs a secret, an unknown action ran before the tests, an expression
   *  could not be resolved, or the test command was guessed. */
  partial: boolean;
  workflow?: string;
  job?: string;
  /** `uses:` steps we cannot reproduce, with their context, for the agent fallback (§5.2 step 3.5). */
  unknownActions: UnknownAction[];
};

// ── Token tree → plain values ─────────────────────────────────────────────

/** An unevaluated `${{ }}` value. A string with embedded expressions arrives
 *  as one format() expression, and `source` keeps the original text. */
type Expr = { $expr: string; source?: string };
type Plain = string | number | boolean | null | Expr | Plain[] | { [key: string]: Plain };
type Obj = { [key: string]: Plain };

const isExpr = (v: unknown): v is Expr => typeof v === "object" && v !== null && "$expr" in v;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && !isExpr(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** `source` is the raw YAML text: a quoted scalar still has its quotes. */
function unquote(source: string): string {
  const t = source.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return source;
}

function plain(wp: WorkflowParser, t: TemplateToken): Plain {
  if (wp.isMapping(t)) {
    const out: Obj = {};
    for (const { key, value } of t) out[String(plain(wp, key))] = plain(wp, value);
    return out;
  }
  if (wp.isSequence(t)) return [...t].map((v) => plain(wp, v));
  if (wp.isBasicExpression(t)) return { $expr: t.expression, ...(t.source ? { source: unquote(t.source) } : {}) };
  if (wp.isLiteral(t)) return (t as unknown as { value?: string | number | boolean }).value ?? null;
  return null;
}

// ── Expressions ───────────────────────────────────────────────────────────

const CONTEXTS = ["github", "env", "matrix", "strategy", "runner", "job", "steps", "needs", "inputs", "secrets", "vars"];

type Ctx = { [K in "github" | "env" | "matrix" | "strategy" | "runner" | "job" | "inputs"]: Record<string, unknown> };

/** What evaluating touched: secrets and contexts we cannot know ahead of a run. */
type Uses = { secrets: Set<string>; unresolved: Set<string> };
const newUses = (): Uses => ({ secrets: new Set(), unresolved: new Set() });

/** We are simulating the upstream repository, so its own-repo guards hold
 *  (§5.2 step 3.9). Fork CI evaluates them for real. */
function presubstitute(expr: string): string {
  return expr
    .replace(/github\.repository(?:_owner)?\s*(==|!=)\s*'[^']*'/gi, (_m, op: string) => (op === "==" ? "true" : "false"))
    .replace(/'[^']*'\s*(==|!=)\s*github\.repository(?:_owner)?\b/gi, (_m, op: string) => (op === "==" ? "true" : "false"));
}

function toJs(ex: typeof Expressions, d: Expressions.data.ExpressionData): unknown {
  const K = ex.data.Kind;
  switch (d.kind) {
    case K.Null: return null;
    case K.Array: return (d as Expressions.data.Array).values().map((v) => toJs(ex, v));
    case K.Dictionary: return Object.fromEntries((d as Expressions.data.Dictionary).pairs().map((p) => [p.key, toJs(ex, p.value)]));
    default: return (d as Expressions.data.StringData).value;
  }
}

type Fn = { name: string; minArgs: number; maxArgs: number; call: () => Expressions.data.ExpressionData };

class Evaluator {
  /** Runner-only functions: job status (we assume success) and hashFiles. */
  private readonly fns: { infos: Omit<Fn, "call">[]; map: Map<string, Fn> };

  constructor(private readonly lib: Libs) {
    const { data } = lib.ex;
    const constant = (name: string, value: boolean) => ({ name, minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(value) });
    const defs = [constant("success", true), constant("always", true), constant("failure", false), constant("cancelled", false),
      { name: "hashFiles", minArgs: 1, maxArgs: 255, call: () => new data.StringData("") }];
    this.fns = { infos: defs.map(({ name, minArgs, maxArgs }) => ({ name, minArgs, maxArgs })), map: new Map(defs.map((d) => [d.name.toLowerCase(), d])) };
  }

  /** Evaluate one expression. Unknown functions or syntax return undefined. */
  expr(source: string, ctx: Ctx, uses: Uses): unknown {
    const { ex } = this.lib;
    for (const m of source.matchAll(/\b(secrets|steps|needs|vars)\s*\.\s*([\w-]+)/g)) {
      if (m[1] === "secrets") uses.secrets.add(m[2]);
      else uses.unresolved.add(`${m[1]}.${m[2]}`);
    }
    try {
      const tokens = new ex.Lexer(presubstitute(source)).lex().tokens;
      const ast = new ex.Parser(tokens, CONTEXTS, this.fns.infos).parse();
      const dict = JSON.parse(JSON.stringify({ ...ctx, steps: {}, needs: {}, secrets: {}, vars: {} }), ex.data.reviver) as Expressions.data.Dictionary;
      return toJs(ex, new ex.Evaluator(ast, dict, this.fns.map).evaluate());
    } catch {
      uses.unresolved.add(`\${{ ${source.slice(0, 80)} }}`);
      return undefined;
    }
  }

  /** A plain value with its expressions evaluated, recursively. */
  value(v: Plain | undefined, ctx: Ctx, uses: Uses): unknown {
    if (isExpr(v)) {
      // Interpolate the original text rather than evaluate the format() call:
      // @actions/expressions unescapes only the first '' in a string literal,
      // so `pip install '.[${{ x }}]'` would gain a stray quote.
      const whole = v.source === undefined || /^\s*\$\{\{(?:(?!\}\})[\s\S])*\}\}\s*$/.test(v.source);
      if (whole) return this.expr(v.source === undefined ? v.$expr : v.source.trim().slice(3, -2), ctx, uses);
      return v.source!.replace(/\$\{\{([\s\S]*?)\}\}/g, (_m, e: string) => {
        const r = this.expr(e, ctx, uses);
        return r === null || r === undefined ? "" : typeof r === "object" ? JSON.stringify(r) : String(r);
      });
    }
    if (Array.isArray(v)) return v.map((x) => this.value(x, ctx, uses));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.value(x, ctx, uses)]));
    return v;
  }

  str(v: Plain | undefined, ctx: Ctx, uses: Uses): string {
    const r = this.value(v, ctx, uses);
    if (r === null || r === undefined) return "";
    return typeof r === "object" ? JSON.stringify(r) : String(r);
  }

  /** An `if:` condition: a bare string is an expression too. Missing = true. */
  cond(v: Plain | undefined, ctx: Ctx, uses: Uses): boolean {
    if (v === undefined || v === null || v === "") return true;
    const r = typeof v === "string" ? this.expr(v.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1"), ctx, uses) : this.value(v, ctx, uses);
    if (r === undefined) return true; // could not evaluate: keep the step, noted as unresolved
    return !(r === null || r === false || r === 0 || r === "" || Number.isNaN(r));
  }
}

// ── Classification ────────────────────────────────────────────────────────

const INSTALL_LINE = /^\s*(?:sudo\s+)?(?:python[\d.]*\s+-m\s+)?(?:pip[\d.]*|uv\s+pip|pipx|npm|yarn|pnpm|bun|gem|bundle|composer|cargo|apt(?:-get)?|brew|poetry|pdm|conda|mamba|micromamba)\s+(?:install|add|ci|sync|i|update|upgrade)\b|^\s*uv\s+(?:sync|tool\s+install|venv)\b|^\s*go\s+(?:install|get|mod\s+download)\b|^\s*bundle\s*$/;
const TEST_LINE = /\b(?:pytest|py\.test|tox|nox|jest|vitest|mocha|runtests|unittest|rspec|rake|phpunit|pest|ctest|go\s+test|cargo\s+(?:test|nextest|hack\s+test)|(?:mvn|mvnw)\b.*\b(?:test|verify|install)|gradlew?\b.*\b(?:test|check|build)|make\s+(?:\S*test\S*|check|ci)|(?:npm|yarn|pnpm|bun)(?:\s+run)?\s+(?:test|ci)\b|bun\s+test|just\s+test|hatch\s+(?:run\s+)?\S*test|(?:^|[\s/])(?:bin|scripts?|ci|tools)\/(?:run[-_]?)?tests?(?:\.\w+)?(?=\s|$)|test[\w-]*\.sh)\b/;
const LINT_LINE = /\b(?:ruff|flake8|pylint|mypy|pyright|black|isort|eslint|prettier|tsc|golangci-lint|go\s+vet|gofmt|staticcheck|clippy|cargo\s+fmt|rustfmt|rubocop|phpstan|psalm|pint|pre-commit|codespell|typos|shellcheck|actionlint|zizmor|knip|(?:npm|yarn|pnpm)(?:\s+run)?\s+(?:lint|format|typecheck)|make\s+(?:lint|format\S*|typecheck|type-check|style))\b/;

const lines = (script: string) => script.replace(/\\\n\s*/g, " ").split(/\n|&&|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
/** A script runs tests when a line invokes a test runner and is not an
 *  install (`pip install pytest` names pytest but runs nothing). */
export function isTestScript(script: string): boolean {
  return lines(script).some((l) => TEST_LINE.test(l) && !INSTALL_LINE.test(l));
}
export function isLintScript(script: string): boolean {
  return !isTestScript(script) && lines(script).some((l) => LINT_LINE.test(l) && !INSTALL_LINE.test(l));
}

const NAME_BAD = /lint|doc|deploy|release|publish|bench|format|typo|spell|secur|codeql|coverage|label|stale|lock|size|compat|nightly|fuzz|audit|msrv|minimal|semver|zizmor|scorecard|pre-?commit|third.?party|downstream|ecosystem|smoke|style|type.?check|mypy|preview|backport|website|translat|sponsor|people|native|graal|android|e2e|playwright|image|docker|wasm|emscripten|pypy|memray|\bstatus\b|\barch\b/i;

/** A step's own name saying it lints, or runs the tests. */
const LINT_NAME = /\b(?:lint|linting|format|formatting|type ?check|typecheck|mypy|style)\b/i;
const TEST_NAME = /\btests?\b/i;
const NOT_TEST_NAME = /install|setup|set up|build|dependenc|deps|cache|upload|download|coverage|report|lint|remove|clean|prepare/i;

/** Local action references: `./path` and the same-repository `$/path`. */
const localPath = (uses: string): string | null => (/^(?:\.|\$)\//.test(uses) ? uses.slice(2).replace(/\/$/, "") : null);

type Candidate = {
  workflow: string;
  jobId: string;
  job: Obj;
  wf: Obj;
  inputs: Record<string, unknown>;
  order: number;
};

/** How strongly a job looks like "runs the test suite". `runsTests`: its
 *  compiled steps include a test step. */
function scoreJob(c: Candidate, runsTests: boolean): number {
  const text = (v: Plain | undefined) => (isExpr(v) ? v.source ?? v.$expr : typeof v === "string" ? v : "");
  const steps = Array.isArray(c.job.steps) ? c.job.steps.filter(isObj) : [];
  const label = `${c.jobId} ${text(c.job.name)}`;
  let score = 0;
  if (runsTests) score += 5;
  if (/test/i.test(label)) score += 3;
  if (/\bunit\b/i.test(label)) score += 1;
  if (NAME_BAD.test(label)) score -= 4;
  // A job that needs another job's build artifacts is a poor stand-alone choice.
  if (steps.some((s) => /^actions\/download-artifact/i.test(text(s.uses)))) score -= 2;
  const wfName = `${c.workflow} ${typeof c.wf.name === "string" ? c.wf.name : ""}`;
  if (/test|\bci\b/i.test(wfName)) score += 1;
  if (NAME_BAD.test(wfName.replace(/^\.github\/workflows\//, ""))) score -= 2;
  return score;
}

// ── Matrix ────────────────────────────────────────────────────────────────

const OS_VALUE = /ubuntu|macos|windows/i;
const PRERELEASE = /dev|alpha|beta|rc|nightly|pre|canary|next|head|pypy|graal|t$|free.?thread/i;
const VERSION_LIKE = /^v?\d+(?:\.(?:\d+|x|\*))*$|^(?:stable|latest|lts\/\*|lts\/[a-z]+|node|current)$/i;

function versionKey(v: unknown): number[] | null {
  const s = String(v ?? "").trim();
  if (!VERSION_LIKE.test(s)) return PRERELEASE.test(s) || /\d/.test(s) ? [0] : null;
  if (/^(stable|latest|current|node)$/i.test(s) || /^lts\//i.test(s)) return [1, 9999];
  return [1, ...s.replace(/^v/i, "").split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : 9999))];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Expand a strategy.matrix the way GitHub does (product, exclude, include)
 *  and pick one cell: ubuntu first, then the newest stable version of each
 *  versioned axis, in axis order. Returns null when the matrix is computed
 *  at run time (fromJSON of another job's output). */
export function chooseMatrixCell(matrix: unknown): { cell: Record<string, unknown>; cells: number } | null {
  if (matrix === undefined || matrix === null) return { cell: {}, cells: 1 };
  if (typeof matrix !== "object" || Array.isArray(matrix)) return null;
  const m = matrix as Record<string, unknown>;
  const axes = Object.keys(m).filter((k) => k !== "include" && k !== "exclude");
  for (const k of axes) if (!Array.isArray(m[k])) return null;
  let cells: Record<string, unknown>[] = [{}];
  for (const k of axes) cells = cells.flatMap((c) => (m[k] as unknown[]).map((v) => ({ ...c, [k]: v }))).slice(0, 4096);
  if (axes.length === 0) cells = [];
  const matches = (c: Record<string, unknown>, e: Record<string, unknown>, keys: string[]) => keys.every((k) => deepEqual(c[k], e[k]));
  for (const ex of Array.isArray(m.exclude) ? m.exclude : []) {
    if (typeof ex !== "object" || ex === null) continue;
    const e = ex as Record<string, unknown>;
    cells = cells.filter((c) => !matches(c, e, Object.keys(e)));
  }
  for (const inc of Array.isArray(m.include) ? m.include : []) {
    if (typeof inc !== "object" || inc === null) continue;
    const e = inc as Record<string, unknown>;
    const original = Object.keys(e).filter((k) => axes.includes(k));
    // Added to every cell whose original values it does not overwrite;
    // otherwise it becomes a cell of its own.
    let added = false;
    for (const c of axes.length ? cells : []) {
      if (matches(c, e, original)) {
        Object.assign(c, e);
        added = true;
      }
    }
    if (!added) cells.push({ ...e });
  }
  if (cells.length === 0) return { cell: {}, cells: 0 };
  const keys = [...new Set(cells.flatMap((c) => Object.keys(c)))];
  const versioned = keys.filter((k) => cells.some((c) => versionKey(c[k])?.[0] === 1));
  const rank = (c: Record<string, unknown>): number[] => {
    const os = keys.map((k) => c[k]).find((v) => typeof v === "string" && OS_VALUE.test(v));
    const r = [os === undefined || /ubuntu/i.test(String(os)) ? 1 : 0];
    for (const k of versioned) {
      const vk = versionKey(c[k]) ?? [0];
      r.push(vk[0], ...[0, 1, 2].map((i) => vk[i + 1] ?? 0));
    }
    return r;
  };
  let best = cells[0];
  for (const c of cells.slice(1)) if (compareKeys(rank(c), rank(best)) > 0) best = c;
  return { cell: best, cells: cells.length };
}

// ── runs-on ───────────────────────────────────────────────────────────────

/** "ubuntu", or why the job cannot run here. */
export function classifyRunsOn(labels: string[]): "ubuntu" | "non_linux" | "needs_gpu" | "self_hosted" {
  const all = labels.join(" ");
  if (/gpu|cuda|nvidia/i.test(all)) return "needs_gpu";
  if (/macos|windows/i.test(all)) return "non_linux";
  if (/ubuntu/i.test(all) && !/self-hosted/i.test(all)) return "ubuntu";
  return "self_hosted";
}

function runsOnLabels(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === "object") return runsOnLabels((v as Record<string, unknown>).labels ?? (v as Record<string, unknown>).group);
  return [];
}

// ── Setup actions ─────────────────────────────────────────────────────────

type SetupSpec = { tool: string; inputs: string[]; file?: string };

const SETUP_ACTIONS: Record<string, SetupSpec> = {
  "actions/setup-python": { tool: "python", inputs: ["python-version"], file: "python-version-file" },
  "actions/setup-node": { tool: "node", inputs: ["node-version"], file: "node-version-file" },
  "actions/setup-go": { tool: "go", inputs: ["go-version"], file: "go-version-file" },
  "actions/setup-java": { tool: "java", inputs: ["java-version"], file: "java-version-file" },
  "ruby/setup-ruby": { tool: "ruby", inputs: ["ruby-version"] },
  "dtolnay/rust-toolchain": { tool: "rust", inputs: ["toolchain"] },
  "actions-rs/toolchain": { tool: "rust", inputs: ["toolchain"] },
  "astral-sh/setup-uv": { tool: "uv", inputs: ["version"] },
  "pnpm/action-setup": { tool: "pnpm", inputs: ["version"] },
  "pnpm/setup": { tool: "pnpm", inputs: ["version"] },
  "oven-sh/setup-bun": { tool: "bun", inputs: ["bun-version"], file: "bun-version-file" },
  "shivammathur/setup-php": { tool: "php", inputs: ["php-version"] },
  "gradle/actions/setup-gradle": { tool: "gradle", inputs: ["gradle-version"] },
  "gradle/gradle-build-action": { tool: "gradle", inputs: ["gradle-version"] },
};

/** Steps that do nothing for a test environment: checkout, caches,
 *  artifacts, coverage upload, and anything deploy-like (§5.2 step 3.4). */
const SKIP_ACTION = /^(?:actions\/(?:checkout|cache|upload-artifact|download-artifact|configure-pages|upload-pages-artifact|deploy-pages)|codecov\/|coverallsapp\/|swatinem\/rust-cache|step-security\/harden-runner|docker\/(?:login-action|metadata-action|build-push-action)|pypa\/gh-action-pypi-publish|softprops\/action-gh-release)|deploy|publish|release|gh-pages/i;

/** mise spellings: "3.x" -> "3", "lts/*" -> "lts", "v20" -> "20". */
export function normalizeVersion(v: string): string {
  const s = v.trim().split(/\s*\n\s*/).filter(Boolean).at(-1) ?? "";
  return s.replace(/^v(?=\d)/i, "").replace(/(?:\.(?:x|\*))+$/i, "").replace(/^lts\/\*$/i, "lts").replace(/^lts\/([a-z]+)$/i, "lts");
}

/** A version from a version file the setup action was pointed at. */
export function versionFromFile(path: string, content: string): string | null {
  const name = path.split("/").pop() ?? path;
  if (name === "go.mod") return /^toolchain\s+go(\S+)/m.exec(content)?.[1] ?? /^go\s+(\S+)/m.exec(content)?.[1] ?? null;
  if (name === "package.json") {
    try {
      const pkg = JSON.parse(content) as { volta?: { node?: string }; engines?: { node?: string } };
      return pkg.volta?.node ?? pkg.engines?.node?.replace(/^[\^~>=\s]+/, "").split(/\s/)[0] ?? null;
    } catch {
      return null;
    }
  }
  if (name === "pyproject.toml") {
    const spec = /^requires-python\s*=\s*["']([^"']+)["']/m.exec(content)?.[1];
    if (!spec) return null;
    // setup-python resolves a range to the newest matching release.
    const exact = /^\s*(?:==|~=)\s*(\d+(?:\.\d+)*)/.exec(spec)?.[1];
    return exact ?? "latest";
  }
  if (name === ".tool-versions") return null; // several tools: read by the mise layer
  const first = content.split("\n").map((l) => l.replace(/#.*/, "").trim()).find(Boolean);
  return first ? first.replace(/^(?:python|nodejs|node)[-@\s]/i, "") : null;
}

// ── Step compilation ──────────────────────────────────────────────────────

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command line for one `run:` step: its shell, working directory and
 *  env, in a subshell so a `cd` or `export` does not leak into the next step
 *  (each CI step is its own process). */
export function stepCommand(script: string, opts: { shell?: string; workingDirectory?: string; env?: Record<string, string> }): string {
  // A block scalar with an expression arrives with its YAML indentation.
  const raw = script.replace(/\r\n/g, "\n").split("\n");
  const indent = Math.min(...raw.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  const body = raw.map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length))).join("\n").trim();
  const env = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${envQuote(v)}`);
  const cd = opts.workingDirectory && opts.workingDirectory !== "." ? `cd ${shellQuote(opts.workingDirectory)} && ` : "";
  const shell = (opts.shell ?? "").trim();
  const prefix = env.length ? `${env.join(" ")} ` : "";
  if (!shell || shell === "bash" || shell === "sh") {
    const single = !body.includes("\n");
    if (single && !env.length) {
      const leaks = /(^|[;&|(]\s*)(cd|source|export|pushd|set|\.)\s/.test(body);
      return cd || leaks ? `(${cd}${body})` : body;
    }
    const sh = shell === "sh" ? "sh -e" : shell === "bash" ? "bash --noprofile --norc -eo pipefail" : "bash -e";
    return `${cd ? `(${cd}` : ""}${prefix}${sh} -c ${shellQuote(body)}${cd ? ")" : ""}`;
  }
  if (/^python3?$/.test(shell)) return `${cd ? `(${cd}` : ""}${prefix}${shell} -c ${shellQuote(body)}${cd ? ")" : ""}`;
  // Custom shells use {0} for the script file.
  const file = "\"$f\"";
  const run = shell.includes("{0}") ? shell.replace("{0}", file) : `${shell} ${file}`;
  return `(${cd}f=$(mktemp) && printf '%s\\n' ${shellQuote(body)} > "$f" && ${prefix}${run})`;
}

// ── Compilation ───────────────────────────────────────────────────────────

export type CompileInput = {
  repo: string;
  /** Repository files by path: every .github/workflows/*.yml, local
   *  action.yml files, and any version file a setup action points at. */
  files: Record<string, string>;
  /** Default branch, for github.base_ref. */
  defaultBranch?: string;
};

function triggers(on: Plain | undefined): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isObj(on)) return Object.keys(on);
  return [];
}

/** Inputs of a reusable workflow or action: declared defaults, then the
 *  caller's `with:` values. */
function inputsWith(declared: Plain | undefined, given: Record<string, unknown>, ev: Evaluator, ctx: Ctx, uses: Uses): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(obj(declared))) {
    const def = obj(d).default;
    if (def !== undefined) out[k] = ev.value(def, ctx, uses);
  }
  return { ...out, ...given };
}

function parseFile(lib: Libs, kind: "workflow" | "action", path: string, content: string, notes: string[]): Obj | null {
  const trace = new lib.wp.NoOperationTraceWriter();
  const r = kind === "workflow" ? lib.wp.parseWorkflow({ name: path, content }, trace) : lib.ap.parseAction({ name: path, content }, trace);
  const errors = r.context.errors.getErrors();
  if (errors.length) notes.push(`${path}: ${errors.length} schema error(s), first: ${errors[0].message.slice(0, 160)}`);
  return r.value ? obj(plain(lib.wp, r.value)) : null;
}

type StepOut = { kind: "setup" | "test" | "lint"; command: string };

type JobState = {
  ev: Evaluator;
  lib: Libs;
  files: Record<string, string>;
  notes: string[];
  runtimes: Record<string, string>;
  steps: StepOut[];
  unknown: UnknownAction[];
  partial: string[];
  seenTest: boolean;
};

function setupRuntime(st: JobState, action: string, ref: string, w: Record<string, string>): void {
  const spec = SETUP_ACTIONS[action];
  let version = spec.inputs.map((i) => w[i]).find((v) => v && v.trim()) ?? "";
  if (!version && spec.file && w[spec.file]) {
    const file = w[spec.file].replace(/^\.\//, "");
    const content = st.files[file];
    version = content === undefined ? "" : versionFromFile(file, content) ?? "";
    if (!version) st.notes.push(`${action}: version file ${file} not read; using latest`);
  }
  if (!version && spec.tool === "rust" && /^(stable|beta|nightly|\d+\.\d+(?:\.\d+)?)$/.test(ref)) version = ref;
  if (!version && spec.tool === "pnpm" && st.files["package.json"]) {
    version = /"packageManager"\s*:\s*"pnpm@([^"+]+)/.exec(st.files["package.json"])?.[1] ?? "";
  }
  if (!version && spec.tool === "python" && st.files[".python-version"]) version = versionFromFile(".python-version", st.files[".python-version"]) ?? "";
  // setup-ruby: "ruby" / "default" mean the latest release or .ruby-version.
  if (spec.tool === "ruby" && /^(ruby|default)$/.test(version.trim())) version = st.files[".ruby-version"]?.trim() ?? "";
  if (!version && spec.tool === "rust") version = "stable";
  let v = normalizeVersion(version) || "latest";
  if (spec.tool === "java" && w.distribution && /^(temurin|zulu|corretto|liberica)$/i.test(w.distribution)) v = `${w.distribution.toLowerCase()}-${v}`;
  st.runtimes[spec.tool] = v;
  // setup-uv can also pin the interpreter.
  if (action === "astral-sh/setup-uv" && w["python-version"] && !st.runtimes.python) st.runtimes.python = normalizeVersion(w["python-version"]);
}

function compileSteps(st: JobState, steps: Plain[], ctx: Ctx, defaults: { shell?: string; workingDirectory?: string }, where: string, depth: number): void {
  steps.forEach((raw, index) => {
    const step = obj(raw);
    const firstLine = typeof step.run === "string" ? step.run.trim().split("\n")[0].slice(0, 60) : "";
    const label = [step.name, step.id, firstLine, step.uses].find((v): v is string => typeof v === "string" && v !== "") ?? `${where} step ${index + 1}`;
    const uses = newUses();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(step.env))) {
      const u = newUses();
      const val = st.ev.str(v, { ...ctx, env: { ...ctx.env, ...env } }, u);
      if (u.secrets.size) uses.secrets.add([...u.secrets].join(","));
      else if (val !== "" || !u.unresolved.size) env[k] = val;
      for (const r of u.unresolved) uses.unresolved.add(r);
    }
    const stepCtx: Ctx = { ...ctx, env: { ...ctx.env, ...env } };
    if (!st.ev.cond(step.if, stepCtx, uses)) {
      st.notes.push(`skipped "${label}": its if: is false here`);
      return;
    }
    if (typeof step.uses === "string") {
      const [action, ref = ""] = step.uses.split("@");
      const name = action.toLowerCase().replace(/\/$/, "");
      const local = action.replace(/\/$/, "");
      const w: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(step.with))) w[k] = st.ev.str(v, stepCtx, newUses());
      if (SETUP_ACTIONS[name]) return setupRuntime(st, name, ref, w);
      // Retry wrappers run a shell command given as an input.
      if (/^(?:nick-fields\/retry|wandalen\/wretry\.action)$/.test(name) && w.command) return runStep(st, label, w.command, step, stepCtx, uses, defaults, env);
      if (SKIP_ACTION.test(name)) return;
      const dir = localPath(local);
      if (dir !== null && depth < 4) {
        const path = [`${dir}/action.yml`, `${dir}/action.yaml`].find((p) => st.files[p] !== undefined);
        const action = path ? parseFile(st.lib, "action", path, st.files[path], st.notes) : null;
        const runs = obj(action?.runs);
        if (action && runs.using === "composite" && Array.isArray(runs.steps)) {
          const inputs = inputsWith(action.inputs, w, st.ev, stepCtx, newUses());
          const github = { ...ctx.github, action_path: `$GITHUB_WORKSPACE/${dir}` };
          compileSteps(st, runs.steps, { ...stepCtx, inputs, github }, {}, `${dir}`, depth + 1);
          return;
        }
      }
      st.unknown.push({ uses: step.uses, step: label, with: w });
      if (!st.seenTest) st.partial.push(`unknown action ${step.uses} runs before the tests`);
      return;
    }
    if (step.run === undefined) return;
    runStep(st, label, st.ev.str(step.run, stepCtx, uses), step, stepCtx, uses, defaults, env);
  });
}

/** One `run:` step (or a retry wrapper's command): classify, then keep,
 *  skip or drop it. */
function runStep(st: JobState, label: string, script: string, step: Obj, stepCtx: Ctx, uses: Uses, defaults: { shell?: string; workingDirectory?: string }, env: Record<string, string>): void {
  const name = typeof step.name === "string" ? step.name : "";
  let kind: StepOut["kind"] = isTestScript(script) ? "test" : isLintScript(script) ? "lint" : "setup";
  if (kind === "setup" && LINT_NAME.test(name)) kind = "lint";
  else if (kind === "setup" && TEST_NAME.test(name) && !NOT_TEST_NAME.test(name)) kind = "test";
  // "Install Playwright for @vitest/test-browser" names a runner but installs.
  else if (kind === "test" && /\binstall\b/i.test(name)) kind = "setup";
  // Debug output (versions, contexts) sets nothing up; `echo ... && exit 1`
  // is a guard for a failed earlier step.
  const ls = lines(script);
  if (kind === "setup" && ls.every((l) => /^(?:echo|printf)\b/.test(l) && !/>/.test(l) || /^exit\s+\d+$/.test(l))) {
    st.notes.push(`dropped "${label}": ${ls.some((l) => /^exit\s+[1-9]/.test(l)) ? "a failure guard" : "only prints"}`);
    return;
  }
  if (uses.secrets.size) {
    if (kind !== "test") {
      st.notes.push(`skipped "${label}": needs secrets ${[...uses.secrets].join(", ")}`);
      return;
    }
    st.partial.push(`test step "${label}" needs secrets ${[...uses.secrets].join(", ")}`);
  }
  if (uses.unresolved.size) {
    st.notes.push(`"${label}": unresolved ${[...uses.unresolved].join(", ")}`);
    if (kind === "test") st.partial.push(`test step "${label}" uses values only known during a real run`);
  }
  const shell = typeof step.shell === "string" ? step.shell : defaults.shell;
  const wd = typeof step["working-directory"] === "string" ? st.ev.str(step["working-directory"], stepCtx, newUses()) : defaults.workingDirectory;
  let command = stepCommand(script, { shell, workingDirectory: wd, env });
  if (kind === "setup" && step["continue-on-error"] === true) command += ` || echo "[opensrcer] step allowed to fail: ${label.replace(/["`$\\]/g, "")}"`;
  if (kind === "test") st.seenTest = true;
  // After the first test step, only tests count: coverage reports and
  // uploads that follow are CI bookkeeping.
  if (kind === "setup" && st.seenTest) {
    st.notes.push(`dropped "${label}": runs after the tests`);
    return;
  }
  st.steps.push({ kind, command });
}

function defaultsOf(...levels: Plain[]): { shell?: string; workingDirectory?: string } {
  const out: { shell?: string; workingDirectory?: string } = {};
  for (const level of levels) {
    const run = obj(obj(obj(level).defaults).run);
    if (typeof run.shell === "string") out.shell = run.shell;
    if (typeof run["working-directory"] === "string") out.workingDirectory = run["working-directory"];
  }
  return out;
}

function services(ev: Evaluator, raw: Plain | undefined, ctx: Ctx, notes: string[]): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  for (const [name, def] of Object.entries(obj(raw))) {
    const d = obj(def);
    const image = ev.str(d.image, ctx, newUses());
    if (!image) continue;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(d.env))) {
      const u = newUses();
      const val = ev.str(v, ctx, u);
      if (u.secrets.size) notes.push(`service ${name}: env ${k} needs a secret; left unset`);
      else env[k] = val;
    }
    const ports = (Array.isArray(d.ports) ? d.ports : [])
      .map((p) => Number(String(ev.str(p, ctx, newUses())).split(":")[0]))
      .filter((p) => Number.isInteger(p) && p > 0);
    out.push({ name, image, ...(Object.keys(env).length ? { env } : {}), ...(ports.length ? { ports } : {}) });
  }
  return out;
}

/** Compile the repository's workflows into a recipe. */
export async function compileCi(input: CompileInput): Promise<CompileResult> {
  const lib = await loadLibs();
  const ev = new Evaluator(lib);
  const notes: string[] = [];
  const github = {
    repository: input.repo, repository_owner: input.repo.split("/")[0], event_name: "pull_request",
    sha: "0".repeat(40), ref: "refs/pull/1/merge", ref_name: "1/merge", head_ref: "opensrcer", base_ref: input.defaultBranch ?? "main",
    workspace: "$GITHUB_WORKSPACE", server_url: "https://github.com", api_url: "https://api.github.com", actor: "opensrcer",
    run_id: "1", run_number: "1", run_attempt: "1", job: "",
    event: { pull_request: { number: 1, head: { ref: "opensrcer", sha: "0".repeat(40) }, base: { ref: input.defaultBranch ?? "main" } } },
  };
  const runner = { os: "Linux", arch: "X64", temp: "/tmp", tool_cache: "/opt/hostedtoolcache", name: "opensrcer" };
  const base: Ctx = { github, env: {}, matrix: {}, strategy: {}, runner, job: { status: "success" }, inputs: {} };

  const paths = Object.keys(input.files).filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort();
  const parsed = new Map<string, Obj>();
  for (const p of paths) {
    const wf = parseFile(lib, "workflow", p, input.files[p], notes);
    if (wf) parsed.set(p, wf);
  }

  // Candidates: jobs of push/pull_request workflows, with local reusable
  // workflows (`uses: ./.github/workflows/x.yml`) expanded into their jobs.
  const candidates: Candidate[] = [];
  // A job's if: that reads other jobs' outputs (a paths filter: "run when
  // src changed") cannot be known ahead of a run; such a job counts as
  // running, since the change being tested is in the repository's code.
  const jobCond = (cond: Plain | undefined, ctx: Ctx) => {
    const u = newUses();
    return ev.cond(cond, ctx, u) || [...u.unresolved].some((r) => /^(?:needs|steps|vars)\./.test(r));
  };
  const expand = (workflow: string, wf: Obj, inputs: Record<string, unknown>, depth: number) => {
    for (const [jobId, j] of Object.entries(obj(wf.jobs))) {
      const job = obj(j);
      if (typeof job.uses === "string") {
        const target = localPath(job.uses.split("@")[0]);
        const callee = target === null ? undefined : parsed.get(target);
        if (target === null || !callee || depth > 2) {
          notes.push(`${workflow} job ${jobId}: reusable workflow ${job.uses} not inlined`);
          continue;
        }
        const u = newUses();
        if (!jobCond(job.if, { ...base, inputs })) continue;
        const given = ev.value(job.with, { ...base, inputs }, u) as Record<string, unknown> | undefined;
        const declared = obj(obj(callee.on).workflow_call).inputs;
        expand(target, callee, inputsWith(declared, given ?? {}, ev, base, u), depth + 1);
        continue;
      }
      candidates.push({ workflow, jobId, job, wf, inputs, order: candidates.length });
    }
  };
  for (const [p, wf] of parsed) {
    const on = triggers(wf.on);
    if (on.includes("push") || on.includes("pull_request")) expand(p, wf, {}, 0);
  }
  if (!candidates.length) {
    return { recipe: null, notes: [...notes, "no workflow runs on push or pull_request"], unreachable: "no_tests", partial: false, unknownActions: [] };
  }

  // Every candidate is compiled (cheap: no I/O), so "runs tests" is judged
  // on the steps that would really run: composites inlined, expressions
  // filled in, if:s applied.
  const compileJob = (c: Candidate, cell: Record<string, unknown>) => {
    const jobNotes: string[] = [];
    const servicePorts = Object.fromEntries(services(ev, c.job.services, { ...base, matrix: cell }, []).map((sv) => [sv.name, { ports: Object.fromEntries((sv.ports ?? []).map((p) => [String(p), String(p)])) }]));
    const ctx: Ctx = { ...base, inputs: c.inputs, matrix: cell, github: { ...github, job: c.jobId }, job: { status: "success", services: servicePorts } };
    const env: Record<string, string> = {};
    for (const level of [c.wf.env, c.job.env]) {
      for (const [k, v] of Object.entries(obj(level))) {
        const u = newUses();
        const val = ev.str(v, { ...ctx, env }, u);
        if (u.secrets.size) jobNotes.push(`env ${k} needs a secret; left unset`);
        else if (val !== "" || !u.unresolved.size) env[k] = val;
      }
    }
    const st: JobState = { ev, lib, files: input.files, notes: jobNotes, runtimes: {}, steps: [], unknown: [], partial: [], seenTest: false };
    compileSteps(st, Array.isArray(c.job.steps) ? c.job.steps : [], { ...ctx, env }, defaultsOf(c.wf, c.job), c.jobId, 0);
    return { st, env, ctx };
  };

  type Scored = Candidate & { score: number; cell: Record<string, unknown>; cellNote: string; place: ReturnType<typeof classifyRunsOn>; matrixUnresolved: boolean; cells: number; compiled: ReturnType<typeof compileJob> };
  const scored: Scored[] = [];
  for (const c of candidates) {
    const u = newUses();
    const ctx = { ...base, inputs: c.inputs, env: {} };
    if (!jobCond(c.job.if, ctx)) {
      notes.push(`job ${c.jobId} skipped: its if: is false here`);
      continue;
    }
    const strategy = obj(c.job.strategy);
    const matrixValue = strategy.matrix === undefined ? undefined : ev.value(strategy.matrix, ctx, u);
    // A matrix that evaluates to nothing was computed at run time.
    const chosen = strategy.matrix !== undefined && (matrixValue === undefined || matrixValue === null) ? null : chooseMatrixCell(matrixValue);
    const cell = chosen?.cell ?? {};
    const runsOn = ev.value(c.job["runs-on"], { ...ctx, matrix: cell }, u);
    const labels = runsOnLabels(runsOn).filter(Boolean);
    const place = labels.length ? classifyRunsOn(labels) : "ubuntu";
    const cellNote = Object.entries(cell).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ");
    const compiled = compileJob(c, cell);
    const score = scoreJob(c, compiled.st.steps.some((s) => s.kind === "test"));
    scored.push({ ...c, score, cell, cellNote, place, matrixUnresolved: chosen === null, cells: chosen?.cells ?? 1, compiled });
  }
  // Ties go to the bigger matrix: the main test job is usually the one CI
  // runs across the most versions.
  const byScore = (a: Scored, b: Scored) => b.score - a.score || b.cells - a.cells || a.order - b.order;
  // A test job runs a test runner or at least calls itself a test.
  const MIN_SCORE = 3;
  const eligible = scored.filter((s) => s.place === "ubuntu" && s.score >= MIN_SCORE).sort(byScore);
  notes.push(`ci: candidates ${[...scored].sort(byScore).slice(0, 4).map((s) => `${s.workflow.replace(/^\.github\/workflows\//, "")}#${s.jobId}=${s.score}${s.place === "ubuntu" ? "" : `(${s.place})`}`).join(", ")}`);
  const best = eligible[0];
  if (!best) {
    const offLinux = scored.filter((s) => s.score >= MIN_SCORE).sort(byScore)[0];
    if (offLinux) {
      return { recipe: null, notes: [...notes, `the test job ${offLinux.workflow}#${offLinux.jobId} runs on ${offLinux.place}`], unreachable: offLinux.place as Unreachable, partial: false, workflow: offLinux.workflow, job: offLinux.jobId, unknownActions: [] };
    }
    return { recipe: null, notes: [...notes, "no job looks like it runs tests"], unreachable: "no_tests", partial: false, unknownActions: [] };
  }

  // The chosen job's recipe.
  const { st, env, ctx } = best.compiled;
  const partial = st.partial;
  notes.push(`ci: ${best.workflow} job ${best.jobId}${best.cellNote ? ` (matrix: ${best.cellNote})` : ""}`, ...st.notes);
  if (best.matrixUnresolved) partial.push("the job's matrix is computed at run time");
  if (best.job.container !== undefined) notes.push(`the job runs inside a container (${ev.str(obj(best.job.container).image ?? best.job.container, ctx, newUses()).slice(0, 80)}); the recipe runs on the base image`);

  let test = st.steps.filter((s) => s.kind === "test").map((s) => s.command);
  let setup = st.steps.filter((s) => s.kind === "setup").map((s) => s.command);
  if (!test.length && setup.length) {
    // The job calls itself a test but no line names a known runner: its
    // last step is the best guess.
    test = [setup[setup.length - 1]];
    setup = setup.slice(0, -1);
    partial.push("no step names a known test runner; the job's last step is assumed to be the test");
  }
  const timeoutMinutes = typeof best.job["timeout-minutes"] === "number" ? best.job["timeout-minutes"] : null;
  const recipe: EnvRecipe = {
    repo: input.repo,
    source: "ci",
    runtimes: st.runtimes,
    services: services(ev, best.job.services, ctx, notes),
    env,
    setup,
    test,
    lint: st.steps.filter((s) => s.kind === "lint").map((s) => s.command),
    timeouts: { ...DEFAULT_TIMEOUTS, ...(timeoutMinutes ? { testMs: timeoutMinutes * 60_000 } : {}) },
  };
  for (const p of partial) notes.push(`partial: ${p}`);
  if (!recipe.test.length) {
    return { recipe: null, notes: [...notes, "the chosen job has no runnable steps"], unreachable: "no_tests", partial: false, workflow: best.workflow, job: best.jobId, unknownActions: st.unknown };
  }
  return { recipe, notes, partial: partial.length > 0, workflow: best.workflow, job: best.jobId, unknownActions: st.unknown };
}
