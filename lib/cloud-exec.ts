// Hosted exec box (OPENSRCER_HOSTED_EXEC=1): a second, credential-free
// Sandbox VM per run where the target repository's code runs (installs,
// tests, linters). It runs scripts/exec-server.cjs on an exposed port; the
// agent VM's dispatcher and MCP exec tools reach it over HTTPS with a bearer
// token minted here (lib/exec-box.ts `remote` backend).
//
// What the exec VM holds: the snapshot (opensrcer's own public code and
// tools), the repository tarball the agent VM sends it, and its own token.
// No GitHub token, no provider key, no Blob token. Its egress is EXEC_EGRESS
// (package registries and git hosts); the agent VM's egress gains exactly
// this VM's host. Both VMs belong to the run's capacity slot and are stopped
// together (lib/cloud-runs.ts stopRunSandboxes).

import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { waitHealthy } from "./exec-box";
import { execLimits, hostedExecLimits } from "./limits";
import { EXEC_EGRESS } from "./sandbox-egress";
import { assertWorkerProtocol } from "./worker-protocol";

export const EXEC_VM_PORT = 7070;

/** The exec VM's name, derived from the run's server-minted VM name so every
 *  stop path can find it without trusting a worker-written field. */
export function execSandboxName(sandboxName: string): string {
  return `${sandboxName}-exec`;
}

/** The exec server's whole environment, on top of the VM's own base env (PATH,
 *  HOME and CA bundles). Exported for tests: it must carry nothing but the
 *  box's own token and limits. */
export function execServerEnv(token: string, lifetimeMs: number): Record<string, string> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new RangeError("exec token must be 32 random bytes in hex");
  const hosted = hostedExecLimits();
  return {
    EXEC_TOKEN: token,
    EXEC_PORT: String(EXEC_VM_PORT),
    EXEC_HOST: "0.0.0.0",
    EXEC_CMD_TIMEOUT_MS: String(hosted.cmdTimeoutMs),
    EXEC_TOTAL_MS: String(hosted.agentMs),
    EXEC_SETUP_MS: String(hosted.setupMs),
    EXEC_OUTPUT_BYTES: String(execLimits().outputBytes),
    // The server exits by itself when the run's VM would anyway.
    EXEC_MAX_LIFETIME_MS: String(lifetimeMs),
  };
}

/** What the agent VM's worker gets so its dispatcher uses the exec VM: the
 *  capability (URL + token) and the hosted time caps. Exported for tests. */
export function workerExecEnv(box: { url: string; token: string }): Record<string, string> {
  const hosted = hostedExecLimits();
  return {
    OPENSRCER_EXEC: "remote",
    OPENSRCER_EXEC_URL: box.url,
    OPENSRCER_EXEC_TOKEN: box.token,
    OPENSRCER_EXEC_CMD_TIMEOUT_MS: String(hosted.cmdTimeoutMs),
    OPENSRCER_EXEC_SETUP_MS: String(hosted.setupMs),
    OPENSRCER_EXEC_TOTAL_MS: String(hosted.agentMs),
    OPENSRCER_AGENTIC_TIMEOUT_MS: String(hosted.agentMs),
  };
}

export type ExecVm = { url: string; host: string; token: string };

/** Create the run's exec VM and wait until its server answers. Throws on any
 *  failure; the caller stops the VM by name (it may exist half-started). */
export async function startExecVm(name: string, snapshotId: string, lifetimeMs: number): Promise<ExecVm> {
  const token = randomBytes(32).toString("hex");
  const sandbox = await Sandbox.create({
    name, source: { type: "snapshot", snapshotId }, ports: [EXEC_VM_PORT], networkPolicy: EXEC_EGRESS,
    persistent: false, timeout: lifetimeMs, signal: AbortSignal.timeout(60_000),
  });
  await assertWorkerProtocol(sandbox);
  // The work tree lives on the VM's disk under the unprivileged user's home.
  await sandbox.runCommand({
    cmd: "bash", args: ["-c", 'mkdir -p "$HOME/work" && EXEC_ROOT="$HOME/work" exec node scripts/exec-server.cjs'],
    cwd: "/vercel/sandbox", detached: true, signal: AbortSignal.timeout(15_000), env: execServerEnv(token, lifetimeMs),
  });
  const url = sandbox.domain(EXEC_VM_PORT);
  const box = { url, token };
  await waitHealthy(box);
  return { url, host: new URL(url).hostname, token };
}
