// Exec-box lifecycle for one agentic dispatch: before the agent starts
// (clone, start the box, load the pinned commit) and after it exits (take
// the patch, run the verification gate, stop the box). The dispatcher calls
// setupExec/finalizeExec; everything here logs what it did, because a
// silent fallback to the unverified text-diff path is the bug to avoid.

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { boxPatch, boxRequest, initBox, runInBox, resolveExecMode, startExecBox, type ExecBox } from "./exec-box";
import { cloneLimits, execLimits } from "./limits";
import { cloneEnv, setupKey, setupPlan, sparseDirsFor, type ContribProfile, type SetupPlan } from "./contrib-profile";

/** One log line summarizing what the repository asks of contributors. */
export function profileLogLine(p: ContribProfile): string {
  return `[profile] dco=${p.dco} cla=${p.cla ? "required" : "none"} template=${p.prTemplate ? "yes" : "no"} ` +
    `agent-rules=${p.agentInstructions ? "yes" : "no"} ai-policy=${p.aiPolicy.stance}${p.aiPolicy.source ? ` (${p.aiPolicy.source})` : ""} ` +
    `ai-trailer=${p.aiTrailer ?? "none"} sources=${p.sources.join(",") || "none"}\n`;
}
import { parseVerificationPlan, runVerification, verificationLogBlock, type Verification } from "./verify";

const execFileAsync = promisify(execFile);

export type PreparedRepo = { dir: string; sha: string };
export type SetupResult = { status: "ok" | "cached" | "failed" | "none"; hint: string | null; durationMs: number; tail: string };
export type ExecSession = { box: ExecBox; repo: PreparedRepo; workDir: string; profile: ContribProfile; setup: SetupResult };

/** Run the environment recipe in the box before the agent starts, on its own
 *  clock (OPENSRCER_EXEC_SETUP_MS). A persistent plan skips work when the env
 *  volume already holds this hash. Never throws: a failed setup leaves the
 *  run going, with the failure in the log and the prompt. Exported for tests. */
export async function runSetup(box: ExecBox, plan: SetupPlan | null, key: string | null, log: (line: string) => void): Promise<SetupResult> {
  if (!plan) {
    log("[setup] no environment recipe for this repository; the agent installs what it needs\n");
    return { status: "none", hint: null, durationMs: 0, tail: "" };
  }
  const marker = plan.persistent && key ? `~/env/.ok-${key}` : null;
  const script = [
    "set -e",
    "mkdir -p ~/env",
    // The marker alone is not enough: the environment must still work (a venv
    // can outlive the interpreter it links to).
    ...(marker ? [`if [ -f ${marker} ] && { [ ! -e ~/env/venv ] || ~/env/venv/bin/python -c pass; }; then echo "[opensrcer] environment ${key} already set up"; exit 0; fi`] : []),
    ...plan.commands,
    ...(marker ? [`touch ${marker}`] : []),
  ].join("\n");
  const started = Date.now();
  log(`[setup] installing the environment (${plan.commands.length} step(s), timeout ${Math.round(execLimits().setupMs / 60_000)} min)\n`);
  try {
    const r = await runInBox(box, script, execLimits().setupMs, true, true);
    const ok = r.exit_code === 0 && !r.timed_out;
    const status: SetupResult["status"] = ok ? (/already set up/.test(r.output) ? "cached" : "ok") : "failed";
    const tail = r.output.slice(-1500);
    log(`[setup] status=${status} duration=${Math.round(r.duration_ms / 1000)}s${r.timed_out ? " (timed out)" : ""}\n`);
    if (!ok) log(`[setup] output tail:\n${tail.replace(/^/gm, "    ")}\n`);
    return { status, hint: plan.hint, durationMs: Date.now() - started, tail: ok ? "" : tail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[setup] status=failed (${message.slice(0, 300)})\n`);
    return { status: "failed", hint: plan.hint, durationMs: Date.now() - started, tail: message.slice(0, 1500) };
  }
}

/** Prompt notes about the prepared environment. */
export function setupPromptNotes(s: SetupResult): string {
  if (s.status === "ok" || s.status === "cached") return `The host already installed the environment; do not reinstall it. ${s.hint}`;
  if (s.status === "failed") return `The host's environment setup FAILED. Its output ends with:\n\n${"```"}\n${s.tail.slice(-800)}\n${"```"}\n\nFix the setup only if it is quick; otherwise make the fix and say the tests could not run. ${s.hint ?? ""}`;
  return "No environment is pre-installed; install only what the targeted test imports.";
}

/** Clone (or reuse) the MCP server's cached checkout and return its HEAD.
 *  Runs the MCP package's own cache code, so the agent's read tools and the
 *  box see the same commit. */
export async function prepareRepo(repoFull: string, token: string | undefined, repoRef?: string): Promise<PreparedRepo> {
  const script = path.join(process.cwd(), "mcp-server", "dist", "prepare.js");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [script, repoFull], {
      env: childEnv({ OPENSRCER_ALLOWED_REPO: repoFull, GITHUB_TOKEN: token, OPENSRCER_REPO_REF: repoRef, ...cloneEnv(repoFull) }),
      timeout: cloneLimits().timeoutMs * 2 + 60_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`could not prepare the repository: ${stderr || (error instanceof Error ? error.message : String(error))}`.slice(0, 500));
  }
  const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as Partial<PreparedRepo>;
  if (typeof parsed.dir !== "string" || !/^[0-9a-f]{40}$/.test(parsed.sha ?? "")) throw new Error("prepare.js returned no checkout");
  return { dir: parsed.dir, sha: parsed.sha! };
}

/** Start the exec box for a dispatch, or return null for the text-diff path.
 *  An explicitly requested backend that fails to start fails the run; only
 *  `auto` falls back, and says so in the log. */
export async function setupExec(
  repoFull: string,
  dispatchId: string,
  workDir: string,
  repo: PreparedRepo,
  profile: ContribProfile,
  log: (line: string) => void,
): Promise<ExecSession | null> {
  const { mode, reason } = await resolveExecMode();
  log(`[exec] mode=${mode} (${reason})\n`);
  if (mode === "off") {
    log("[exec] no exec box: the agent cannot run code and the patch will be model-typed and UNVERIFIED\n");
    return null;
  }
  const started = Date.now();
  let box: ExecBox | undefined;
  try {
    await mkdir(workDir, { recursive: true });
    const plan = setupPlan(repo.dir, repoFull);
    const key = plan ? setupKey(repo.dir, plan) : null;
    box = await startExecBox(mode, dispatchId, workDir, repoFull, plan?.persistent ? key ?? undefined : undefined);
    const sparse = sparseDirsFor(repoFull);
    const { baseline } = await initBox(box, repo.dir, repo.sha, sparse);
    log(`[exec] box ${box.mode} up, ${repo.sha.slice(0, 12)} loaded${sparse ? ` (sparse: ${sparse.join(" ")})` : ""} as baseline ${baseline.slice(0, 12)} in ${Math.round((Date.now() - started) / 1000)}s\n`);
    // Installs happen here, before the agent's turns and wall clock start.
    const setup = await runSetup(box, plan, key, log);
    return { box, repo, workDir, profile, setup };
  } catch (error) {
    await box?.stop();
    const message = error instanceof Error ? error.message : String(error);
    if ((process.env.OPENSRCER_EXEC ?? "auto").toLowerCase() !== "auto") throw new Error(`exec box failed: ${message}`);
    log(`[exec] box failed (${message.slice(0, 300)}); falling back to the text-diff path — patch will be UNVERIFIED\n`);
    return null;
  }
}

/** Eval mode only: runs against the box after verification, before stop. */
export type EvalHook = (box: ExecBox, patch: string) => Promise<void>;

export type ExecOutcome = { patchPath: string | null; verification: Verification | null; setup?: SetupResult };

/** After the agent exits: take the patch, verify it, stop the box. Never
 *  throws; failures are logged and leave the run unverified. */
export async function finalizeExec(
  session: ExecSession,
  logPath: string,
  opts: { verify: boolean; extraLint?: string[]; evalHook?: EvalHook },
): Promise<ExecOutcome> {
  const log = (s: string) => appendFile(logPath, s).catch(() => {});
  try {
    const patch = await boxPatch(session.box);
    if (!patch.trim()) {
      await log("\n[exec] the workspace has no changes; nothing to publish\n");
      return { patchPath: null, verification: null, setup: session.setup };
    }
    const patchPath = path.join(session.workDir, "final.patch");
    await writeFile(patchPath, patch, { mode: 0o600 });
    // The patch, fenced, so the run page shows exactly what would be published.
    await log(`\n[exec] final patch = git diff of the workspace (${patch.length} bytes)\n\`\`\`diff\n${patch.trimEnd()}\n\`\`\`\n`);
    if (!opts.verify) return { patchPath, verification: null, setup: session.setup };
    const plan = parseVerificationPlan(await readFile(logPath, "utf8"));
    // The agent's own command time (dependency installs, reproduction,
    // exploration) is reported apart from the verification re-runs.
    const health = await boxRequest<{ used_ms: number }>(session.box, "GET", "/health", undefined, 15_000).catch(() => null);
    await log(`\n[verify] agent command time (installs, reproduction, test runs): ${health ? `${Math.round(health.used_ms / 1000)}s` : "unknown"}\n` +
      `[verify] re-running ${plan.test.length} test and ${plan.lint.length + (opts.extraLint?.length ?? 0)} lint command(s) on the final patch\n`);
    const verification = await runVerification(session.box, plan, patch, opts.extraLint);
    await writeFile(path.join(session.workDir, "verification.json"), JSON.stringify(verification), { mode: 0o600 });
    await log(verificationLogBlock(verification));
    // Eval mode only (scripts/eval-merged.cjs): inspect the box before it stops.
    if (opts.evalHook) await opts.evalHook(session.box, patch).catch((e) => log(`\n[eval] hook failed: ${e instanceof Error ? e.message : String(e)}\n`));
    return { patchPath, verification, setup: session.setup };
  } catch (error) {
    await log(`\n[exec] finalize failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)} — run is UNVERIFIED\n`);
    return { patchPath: null, verification: null, setup: session.setup };
  } finally {
    await session.box.stop();
  }
}
