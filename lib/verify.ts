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
};

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
 *  rewrote files (an autofixing formatter), which fails the gate. */
export async function runVerification(
  box: ExecBox,
  plan: VerificationPlan,
  patch: string,
  extraLint: string[] = [],
): Promise<Verification> {
  const lint = [...new Set([...plan.lint, ...extraLint])].slice(0, MAX_COMMANDS);
  const fullPlan = { ...plan, lint };
  const result = (status: Verification["status"], reason: string, regression: Regression, ev: CommandEvidence[]): Verification =>
    ({ status, reason, plan: fullPlan, regression, evidence: ev });

  if (!patch.trim()) return result("unverified", "the workspace has no changes", "skipped", []);
  if (plan.test.length === 0) return result("unverified", "the agent declared no test command", "skipped", []);

  const ev: CommandEvidence[] = [];
  for (const command of plan.test) ev.push(evidence("test", command, await runInBox(box, command, undefined, true)));
  for (const command of lint) ev.push(evidence("lint", command, await runInBox(box, command, undefined, true)));

  const files = diffTouchedFiles(patch);
  const testFiles = files.filter(isTestPath);
  const sourceFiles = files.filter((f) => !isTestPath(f));
  const testsPassed = ev.filter((e) => e.kind === "test").every(passed);
  let regression: Regression = "skipped";
  if (testFiles.length === 0) regression = "no_test_change";
  else if (testsPassed && sourceFiles.length > 0) {
    const r = await runInBox(box, failBeforeScript(sourceFiles, plan.test), undefined, true);
    ev.push(evidence("fail-before", `(source change reverted) ${plan.test.join(" && ")}`, r));
    if (r.exit_code === 97 || r.exit_code === 98) regression = "skipped";
    else regression = r.exit_code === 0 && !r.timed_out ? "not_reproduced" : "reproduced";
  }

  const after = await boxPatch(box);
  if (!testsPassed) return result("failed", "a declared test command failed on the final patch", regression, ev);
  if (!ev.filter((e) => e.kind === "lint").every(passed)) return result("failed", "a lint/format check failed on the final patch", regression, ev);
  if (after !== patch) return result("failed", "verification commands changed the workspace (e.g. a formatter rewrote files); the patch is not clean", regression, ev);
  return result("verified", regression === "reproduced"
    ? "declared tests pass, and fail with the source change reverted"
    : "declared tests and checks pass", regression, ev);
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
  parts.push(`- Regression check: ${REGRESSION_TEXT[v.regression]}`);
  parts.push("", v.status === "verified" ? `Result: verified (${v.reason}).` : `Result: ${v.status.toUpperCase()} — ${v.reason}.`);
  return parts.join("\n");
}

/** Log block for the dispatch log (humans read it on the run page). */
export function verificationLogBlock(v: Verification): string {
  const seconds = v.evidence.reduce((sum, e) => sum + e.duration_ms, 0) / 1000;
  const lines = ["[verify] ─────────────────────────────", `[verify] status=${v.status} regression=${v.regression}`, `[verify] reason=${v.reason}`,
    `[verify] verification time: ${seconds.toFixed(1)}s`];
  for (const e of v.evidence) {
    lines.push(`[verify] ${e.kind}: ${e.command}`);
    lines.push(`[verify]   ${e.timed_out ? "timed out" : `exit=${e.exit_code}`} · ${(e.duration_ms / 1000).toFixed(1)}s`);
    if (e.output_tail.trim()) lines.push(e.output_tail.slice(-1200).replace(/^/gm, "    "));
  }
  lines.push("[verify] ─────────────────────────────");
  return `\n${lines.join("\n")}\n`;
}
