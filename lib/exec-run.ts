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
import { boxPatch, boxRequest, initBox, resolveExecMode, startExecBox, type ExecBox } from "./exec-box";
import { cloneLimits } from "./limits";
import { cloneEnv, sparseDirsFor, type ContribProfile } from "./contrib-profile";

/** One log line summarizing what the repository asks of contributors. */
export function profileLogLine(p: ContribProfile): string {
  return `[profile] dco=${p.dco} cla=${p.cla ? "required" : "none"} template=${p.prTemplate ? "yes" : "no"} ` +
    `agent-rules=${p.agentInstructions ? "yes" : "no"} ai-policy=${p.aiPolicy.stance}${p.aiPolicy.source ? ` (${p.aiPolicy.source})` : ""} ` +
    `ai-trailer=${p.aiTrailer ?? "none"} sources=${p.sources.join(",") || "none"}\n`;
}
import { parseVerificationPlan, runVerification, verificationLogBlock, type Verification } from "./verify";

const execFileAsync = promisify(execFile);

export type PreparedRepo = { dir: string; sha: string };
export type ExecSession = { box: ExecBox; repo: PreparedRepo; workDir: string; profile: ContribProfile };

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
    box = await startExecBox(mode, dispatchId, workDir);
    const sparse = sparseDirsFor(repoFull);
    const { baseline } = await initBox(box, repo.dir, repo.sha, sparse);
    log(`[exec] box ${box.mode} up, ${repo.sha.slice(0, 12)} loaded${sparse ? ` (sparse: ${sparse.join(" ")})` : ""} as baseline ${baseline.slice(0, 12)} in ${Math.round((Date.now() - started) / 1000)}s\n`);
    return { box, repo, workDir, profile };
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

export type ExecOutcome ={ patchPath: string | null; verification: Verification | null };

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
      return { patchPath: null, verification: null };
    }
    const patchPath = path.join(session.workDir, "final.patch");
    await writeFile(patchPath, patch, { mode: 0o600 });
    // The patch, fenced, so the run page shows exactly what would be published.
    await log(`\n[exec] final patch = git diff of the workspace (${patch.length} bytes)\n\`\`\`diff\n${patch.trimEnd()}\n\`\`\`\n`);
    if (!opts.verify) return { patchPath, verification: null };
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
    return { patchPath, verification };
  } catch (error) {
    await log(`\n[exec] finalize failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)} — run is UNVERIFIED\n`);
    return { patchPath: null, verification: null };
  } finally {
    await session.box.stop();
  }
}
