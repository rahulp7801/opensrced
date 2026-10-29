// The verification gate. The agent declares how its fix is checked (a
// ```verification block in its final answer); the HOST then re-runs those
// commands in the exec box against the final state and records what
// actually happened. The PR body's "Tests run" section is built only from
// these host-observed results, never from the model's own account, so a
// claimed green that did not happen cannot reach a maintainer.
//
// On top of "the tests pass", a fail-before check: with the patch's source
// changes reverted and its test changes kept, the declared tests should
// fail. That is the evidence that the new test reproduces the bug.

import { diffTouchedFiles } from "./apply-diff";
import type { ExecBox, RunResult } from "./exec-box";
import { boxPatch, runInBox } from "./exec-box";

export type VerificationPlan = { setup: string[]; test: string[]; lint: string[] };

export type CommandEvidence = {
  kind: "test" | "lint" | "fail-before";
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  output_tail: string;
};

export type Regression =
  | "reproduced"       // tests fail with the source change reverted, pass with it
  | "not_reproduced"   // tests pass even without the fix
  | "no_test_change"   // the patch adds/changes no test file
  | "skipped";         // not attempted (tests failed, or no source change)

export type Verification = {
  status: "verified" | "failed" | "unverified";
  reason: string;
  plan: VerificationPlan;
  regression: Regression;
  evidence: CommandEvidence[];
  /** Only with a baseline: failures that were already failing on main (not
   *  held against the patch), and failures that are new. */
  baseline?: { preexisting: string[]; newFailures: string[] };
};

/** Tests already failing on the default branch (§5.3): their ids, plus the
 *  ones that failed in only some of the baseline runs (flaky). */
export type Baseline = { failing: string[]; flaky?: string[] };

/** Test ids one run reported failing and passing. Ids are compared only
 *  with ids from the same runner's output. */
export type TestReport = { failed: string[]; passed: string[] };

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** pytest output: the short summary (`FAILED a.py::t - msg`, printed for
 *  failures by default and for everything with -rA) and verbose progress
 *  lines (`a.py::t PASSED`). Null when the output is not pytest's. */
export function parsePytestReport(output: string): TestReport | null {
  const text = stripAnsi(output);
  const failed = new Set<string>();
  const passed = new Set<string>();
  for (const line of text.split("\n")) {
    const summary = /^(FAILED|ERROR|PASSED)\s+(\S+)/.exec(line);
    const verbose = /^(\S+::\S+)\s+(FAILED|ERROR|PASSED)\b/.exec(line);
    const [status, id] = summary ? [summary[1], summary[2]] : verbose ? [verbose[2], verbose[1]] : [null, null];
    if (!status || !id) continue;
    (status === "PASSED" ? passed : failed).add(id);
  }
  for (const id of failed) passed.delete(id);
  const recognized = failed.size + passed.size > 0 || /^=+ .*\b(?:passed|failed|errors?|no tests ran)\b.* in [\d.]+s/m.test(text);
  return recognized ? { failed: [...failed], passed: [...passed] } : null;
}

const xmlUnescape = (s: string) => s.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** JUnit XML (pytest --junit-xml, maven surefire, jest-junit): one id per
 *  <testcase>, `classname::name`; failed when it holds <failure> or <error>. */
export function parseJunitReport(xml: string): TestReport | null {
  if (!/<testsuites?\b/.test(xml)) return null;
  const failed: string[] = [];
  const passed: string[] = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], xmlUnescape(a[2])]));
    const id = attrs.classname ? `${attrs.classname}::${attrs.name ?? ""}` : attrs.name ?? "";
    const body = m[2] ?? "";
    if (/<(?:failure|error)\b/.test(body)) failed.push(id);
    else if (!/<skipped\b/.test(body)) passed.push(id);
  }
  return { failed, passed };
}

type JestJson = { testResults?: { name?: string; status?: string; message?: string; assertionResults?: { fullName?: string; title?: string; status?: string }[] }[] };

/** `jest --json` / `vitest --reporter=json`: ids are `file > full name`; a
 *  file that failed to run at all is reported by its path. `root` is
 *  stripped from the absolute file paths when given. */
export function parseJestReport(output: string, root?: string): TestReport | null {
  const start = output.search(/\{\s*"num(?:Failed|Total|Passed)Test/);
  if (start < 0) return null;
  let json: JestJson;
  try {
    json = JSON.parse(output.slice(start, output.lastIndexOf("}") + 1)) as JestJson;
  } catch {
    return null;
  }
  const failed: string[] = [];
  const passed: string[] = [];
  for (const file of json.testResults ?? []) {
    let name = file.name ?? "";
    if (root && name.startsWith(root)) name = name.slice(root.length).replace(/^[\\/]+/, "");
    const cases = file.assertionResults ?? [];
    if (!cases.length && file.status === "failed") failed.push(name);
    for (const c of cases) {
      const id = `${name} > ${c.fullName ?? c.title ?? ""}`;
      if (c.status === "failed") failed.push(id);
      else if (c.status === "passed") passed.push(id);
    }
  }
  return { failed, passed };
}

/** Whichever report the output holds: jest JSON, JUnit XML, then pytest. */
export function parseTestReport(output: string, root?: string): TestReport | null {
  return parseJestReport(output, root) ?? parseJunitReport(output) ?? parsePytestReport(output);
}

/** A baseline from repeated runs of the suite on main: everything that
 *  failed in any run, and as flaky what failed in some runs but not all.
 *  Null when no run's output could be read. */
export function baselineFromRuns(outputs: string[]): Baseline | null {
  const reports = outputs.map((o) => parseTestReport(o)).filter((r): r is TestReport => r !== null);
  if (!reports.length) return null;
  const all = [...new Set(reports.flatMap((r) => r.failed))].sort();
  const flaky = all.filter((id) => !reports.every((r) => r.failed.includes(id)));
  return { failing: all, ...(flaky.length ? { flaky } : {}) };
}

/** Failures in `output` that the baseline does not explain, or null when
 *  the output cannot be read (then the exit code decides, as before). */
export function newFailures(output: string, baseline: Baseline): { preexisting: string[]; fresh: string[] } | null {
  const report = parseTestReport(output);
  if (!report || report.failed.length === 0) return null;
  const known = new Set([...baseline.failing, ...(baseline.flaky ?? [])]);
  return { preexisting: report.failed.filter((id) => known.has(id)), fresh: report.failed.filter((id) => !known.has(id)) };
}

const MAX_COMMANDS = 6;

/** The last ```verification block in the agent's output, one `kind: command`
 *  per line. Unknown kinds and blank lines are ignored. */
export function parseVerificationPlan(text: string): VerificationPlan {
  const plan: VerificationPlan = { setup: [], test: [], lint: [] };
  const blocks = [...text.replace(/\r\n/g, "\n").matchAll(/^```verification[ \t]*\n([\s\S]*?)^```/gm)];
  const body = blocks.at(-1)?.[1];
  if (!body) return plan;
  for (const line of body.split("\n")) {
    const m = /^\s*(setup|test|lint)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const list = plan[m[1].toLowerCase() as keyof VerificationPlan];
    if (list.length < MAX_COMMANDS && m[2].length <= 2000) list.push(m[2]);
  }
  return plan;
}

export type CaseCoverage = { variant: string; test: string | null };

/** The last ```cases block: `case: <variant> -> <test name | not covered>`.
 *  The agent's own account of which reported variants its tests cover. */
export function parseCases(text: string): CaseCoverage[] {
  const blocks = [...text.replace(/\r\n/g, "\n").matchAll(/^```cases[ \t]*\n([\s\S]*?)^```/gm)];
  const body = blocks.at(-1)?.[1];
  if (!body) return [];
  const out: CaseCoverage[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*case\s*:\s*(.+?)\s*->\s*(.+?)\s*$/i.exec(line);
    if (!m || out.length >= 20) continue;
    const test = /^(not covered|none|-)$/i.test(m[2]) ? null : m[2].slice(0, 200);
    out.push({ variant: m[1].slice(0, 300), test });
  }
  return out;
}

/** Test files by the conventions of the ecosystems we target (pytest,
 *  unittest, jest, go). Exported for tests. */
export function isTestPath(file: string): boolean {
  const f = file.replace(/\\/g, "/");
  return /(^|\/)(tests?|__tests__|testing)\//.test(f)
    || /(^|\/)test_[^/]*\.py$/.test(f)
    || /_test\.(py|go)$/.test(f)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)
    || /(^|\/)conftest\.py$/.test(f);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Shell script for the fail-before run: revert only the source half of the
 *  patch, run the tests, restore. Exit 97/98 mean the revert or the restore
 *  itself failed. Exported for tests. */
export function failBeforeScript(sourceFiles: string[], tests: string[]): string {
  const files = sourceFiles.map(shellQuote).join(" ");
  return [
    `git add -A && git diff --cached --binary HEAD -- ${files} > /tmp/opensrcer-src.patch && git reset -q && git apply -R /tmp/opensrcer-src.patch || { echo "[opensrcer] could not revert the source change"; exit 97; }`,
    `( ${tests.map((t) => `(${t})`).join(" && ")} ); rc=$?`,
    `git apply /tmp/opensrcer-src.patch || { echo "[opensrcer] could not restore the source change"; exit 98; }`,
    `exit $rc`,
  ].join("\n");
}

function evidence(kind: CommandEvidence["kind"], command: string, r: RunResult): CommandEvidence {
  return { kind, command, exit_code: r.exit_code, timed_out: r.timed_out, duration_ms: r.duration_ms, output_tail: r.output.slice(-2500) };
}

const passed = (e: CommandEvidence) => e.exit_code === 0 && !e.timed_out;

/** Re-run the declared checks in the box. `patch` is the box patch taken
 *  BEFORE verification; a different patch afterwards means a check
 *  rewrote files (an autofixing formatter), which fails the gate.
 *
 *  With a `baseline` (tests already failing on main), a test command that
 *  fails only with baseline failures counts as passing: "no new failures,
 *  and the new tests behave correctly" (§5.3). The fail-before check then
 *  needs a failure the baseline does not explain. Without one, the exit
 *  code decides, as it always has. */
export async function runVerification(
  box: ExecBox,
  plan: VerificationPlan,
  patch: string,
  extraLint: string[] = [],
  baseline?: Baseline,
): Promise<Verification> {
  const lint = [...new Set([...plan.lint, ...extraLint])].slice(0, MAX_COMMANDS);
  const fullPlan = { ...plan, lint };
  const preexisting = new Set<string>();
  const fresh = new Set<string>();
  const result = (status: Verification["status"], reason: string, regression: Regression, ev: CommandEvidence[]): Verification =>
    ({ status, reason, plan: fullPlan, regression, evidence: ev, ...(baseline ? { baseline: { preexisting: [...preexisting], newFailures: [...fresh] } } : {}) });

  if (!patch.trim()) return result("unverified", "the workspace has no changes", "skipped", []);
  if (plan.test.length === 0) return result("unverified", "the agent declared no test command", "skipped", []);

  const ev: CommandEvidence[] = [];
  let testsPassed = true;
  for (const command of plan.test) {
    const r = await runInBox(box, command, undefined, true);
    const e = evidence("test", command, r);
    ev.push(e);
    if (passed(e)) continue;
    const diff = baseline && !r.timed_out ? newFailures(r.output, baseline) : null;
    if (diff && diff.fresh.length === 0) {
      for (const id of diff.preexisting) preexisting.add(id);
      continue;
    }
    for (const id of diff?.fresh ?? []) fresh.add(id);
    testsPassed = false;
  }
  for (const command of lint) ev.push(evidence("lint", command, await runInBox(box, command, undefined, true)));

  const files = diffTouchedFiles(patch);
  const testFiles = files.filter(isTestPath);
  const sourceFiles = files.filter((f) => !isTestPath(f));
  let regression: Regression = "skipped";
  if (testFiles.length === 0) regression = "no_test_change";
  else if (testsPassed && sourceFiles.length > 0) {
    const r = await runInBox(box, failBeforeScript(sourceFiles, plan.test), undefined, true);
    ev.push(evidence("fail-before", `(source change reverted) ${plan.test.join(" && ")}`, r));
    // Baseline failures alone do not show that the new tests catch the bug.
    const onlyBaseline = baseline && !r.timed_out ? newFailures(r.output, baseline)?.fresh.length === 0 : false;
    if (r.exit_code === 97 || r.exit_code === 98) regression = "skipped";
    else regression = (r.exit_code === 0 && !r.timed_out) || onlyBaseline ? "not_reproduced" : "reproduced";
  }

  const after = await boxPatch(box);
  if (!testsPassed) return result("failed", "a declared test command failed on the final patch", regression, ev);
  if (!ev.filter((e) => e.kind === "lint").every(passed)) return result("failed", "a lint/format check failed on the final patch", regression, ev);
  if (after !== patch) return result("failed", "verification commands changed the workspace (e.g. a formatter rewrote files); the patch is not clean", regression, ev);
  const known = preexisting.size ? ` (apart from ${preexisting.size} test(s) already failing on main)` : "";
  return result("verified", regression === "reproduced"
    ? `declared tests pass${known}, and fail with the source change reverted`
    : `declared tests and checks pass${known}`, regression, ev);
}

/** The sidecar's `tests` field from the host-observed verification. Only a
 *  verified run is "passed"; anything not observed is "not_run". */
export function testOutcome(v: Verification | null): "passed" | "failed" | "not_run" {
  return v?.status === "verified" ? "passed" : v?.status === "failed" ? "failed" : "not_run";
}

const REGRESSION_TEXT: Record<Regression, string> = {
  reproduced: "With the source change reverted (test changes kept) the tests fail; with it they pass.",
  not_reproduced: "The tests also pass with the source change reverted, so they do not reproduce the bug.",
  no_test_change: "The patch adds or changes no test.",
  skipped: "Not run.",
};

/** The "Tests run" section of the PR body: exactly what the host observed. */
export function verificationMarkdown(v: Verification | null): string {
  if (!v || v.evidence.length === 0) {
    return `### Tests run\n\nNot verified${v ? `: ${v.reason}` : ""}. No tests were run against this patch.`;
  }
  const line = (e: CommandEvidence) =>
    `- \`${e.command.replace(/`/g, "'")}\` — ${e.timed_out ? "timed out" : e.exit_code === 0 ? "passed" : `failed (exit ${e.exit_code})`} (${(e.duration_ms / 1000).toFixed(1)}s)`;
  const parts = ["### Tests run", ""];
  parts.push(...v.evidence.filter((e) => e.kind === "test").map(line));
  const lint = v.evidence.filter((e) => e.kind === "lint");
  if (lint.length) parts.push(...lint.map(line));
  if (v.baseline?.preexisting.length) {
    const ids = v.baseline.preexisting.slice(0, 10).map((id) => `\`${id.replace(/`/g, "'")}\``).join(", ");
    parts.push(`- Already failing on the default branch, so not counted against this patch: ${ids}${v.baseline.preexisting.length > 10 ? ` and ${v.baseline.preexisting.length - 10} more` : ""}`);
  }
  parts.push(`- Regression check: ${REGRESSION_TEXT[v.regression]}`);
  parts.push("", v.status === "verified" ? `Result: verified (${v.reason}).` : `Result: ${v.status.toUpperCase()} — ${v.reason}.`);
  return parts.join("\n");
}

/** Log block for the dispatch log (humans read it on the run page). */
export function verificationLogBlock(v: Verification): string {
  const seconds = v.evidence.reduce((sum, e) => sum + e.duration_ms, 0) / 1000;
  const lines = ["[verify] ─────────────────────────────", `[verify] status=${v.status} regression=${v.regression}`, `[verify] reason=${v.reason}`,
    `[verify] verification time: ${seconds.toFixed(1)}s`];
  if (v.baseline) lines.push(`[verify] baseline: ${v.baseline.preexisting.length} already failing on main, ${v.baseline.newFailures.length} new failure(s)${v.baseline.newFailures.length ? `: ${v.baseline.newFailures.slice(0, 10).join(", ")}` : ""}`);
  for (const e of v.evidence) {
    lines.push(`[verify] ${e.kind}: ${e.command}`);
    lines.push(`[verify]   ${e.timed_out ? "timed out" : `exit=${e.exit_code}`} · ${(e.duration_ms / 1000).toFixed(1)}s`);
    if (e.output_tail.trim()) lines.push(e.output_tail.slice(-1200).replace(/^/gm, "    "));
  }
  lines.push("[verify] ─────────────────────────────");
  return `\n${lines.join("\n")}\n`;
}
