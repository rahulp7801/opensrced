// A lesson's hidden fix (PLAN §7.2). The AI solves the issue first, and the
// contributor must not see its code until the lesson reveals it. Instead of
// redacting logs, every route that serves a run's content refuses a hidden
// run outright until a reveal marker exists:
//
//   GET /api/dispatches/<id>           403 (the log holds the diff and PR text)
//   GET /api/dispatches/<id>/preview   403 (diff, diagnosis, title, files)
//   GET /api/dispatches                the row stays, stripped of PR title,
//                                      has_diff and failure reason
//   publish, explain, understand       refused (lib/publish.ts, lib/run-change.ts)
//
// The lesson page shows progress only (runPhase below, no names or text).
//
// The reveal marker is written by the server only, at a path outside every
// worker upload token's scope, so a worker rewriting its own record cannot
// reveal itself. The `hidden` flag itself rides on the run record (set when
// the run starts, carried by the worker's `{ ...run, ...record }` merge).
// ponytail: a worker that dropped the flag would un-hide its own run; a
// server-written hidden index (like the cancellation index) closes that if
// workers ever become untrusted for this.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { readJson, privateJsonOptions } from "./blob-store";
import { cloudExecution, runRevealPath } from "./cloud-run-state";
import type { DispatchRecord } from "./dispatch-store";

export const HIDDEN_RUN_MESSAGE = "This run is part of a lesson. Its fix stays hidden until the lesson reveals it.";

const LOCAL_ID_RE = /^d_[A-Za-z0-9_-]{1,64}$/;
const localRevealPath = (id: string) => join(process.cwd(), ".dispatches", id, "revealed.json");

/** Whether the lesson revealed this run. Owner-scoped on hosted runs. */
export async function runRevealed(owner: string, id: string): Promise<boolean> {
  if (cloudExecution()) return Boolean(await readJson(runRevealPath(owner, id), 10_000));
  return LOCAL_ID_RE.test(id) && existsSync(localRevealPath(id));
}

/** Set the reveal marker. The caller has already checked the lesson allows it
 *  (lib/lesson/machine.ts canReveal) and that `owner` owns the run. */
export async function revealHiddenRun(owner: string, id: string): Promise<void> {
  const marker = JSON.stringify({ revealed_at: new Date().toISOString() });
  if (cloudExecution()) {
    await put(runRevealPath(owner, id), marker, { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
    return;
  }
  if (!LOCAL_ID_RE.test(id)) throw new Error("Invalid run id");
  mkdirSync(join(process.cwd(), ".dispatches", id), { recursive: true });
  writeFileSync(localRevealPath(id), marker, { mode: 0o600 });
}

/** True when this run's content must not be served yet. Only hidden runs
 *  pay for the marker read. */
export async function hiddenRunLocked(owner: string, run: { id: string; hidden?: boolean }): Promise<boolean> {
  return run.hidden === true && !await runRevealed(owner, run.id);
}

/** A list row for a locked hidden run: status and timing stay (the dashboard
 *  shows the run exists), anything describing the fix goes. */
export function stripHiddenSummary<T extends Pick<DispatchRecord, "stats" | "pr_failure_reason">>(run: T): T {
  const { pr_failure_reason: _reason, stats, ...rest } = run;
  void _reason;
  return { ...rest, ...(stats ? { stats: { cost_usd: stats.cost_usd } } : {}) } as T;
}

/** The list route's rows, with locked hidden runs stripped. */
export async function visibleRuns<T extends Pick<DispatchRecord, "id" | "hidden" | "stats" | "pr_failure_reason">>(owner: string, runs: T[]): Promise<T[]> {
  return Promise.all(runs.map(async (run) => (await hiddenRunLocked(owner, run) ? stripHiddenSummary(run) : run)));
}

// ── Progress without content ───────────────────────────────────────────────

export type RunPhase = "setting_up" | "solving" | "proving" | "ready" | "failed";

export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  setting_up: "Setting up the project…",
  solving: "Solving…",
  proving: "Proving the fix…",
  ready: "Ready",
  failed: "The hidden fix did not finish",
};

/** The pipeline phase from the run's status and machine-written log markers.
 *  Returns a fixed label only: nothing from the log itself (file names, PR
 *  title, diff) can reach the caller. */
export function runPhase(run: { status: string }, log: string): RunPhase {
  if (run.status === "failed" || run.status === "killed") return "failed";
  if (run.status === "succeeded") return "ready";
  // [exec] mode/box/checkout lines come before the agent; these come after it.
  if (/^\[verify\] |^\[exec\] (?:final patch|finalize|the workspace)|^\[agentic-dispatcher\] exited at /m.test(log)) return "proving";
  if (/^\[tool\] |^\[agentic-dispatcher\] (?:paid by|bin):/m.test(log)) return "solving";
  return "setting_up";
}
