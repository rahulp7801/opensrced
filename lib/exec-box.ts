// Host side of the exec box: the credential-free place where the agent edits
// files and runs the target repository's own code (installs, tests, linters).
// The box itself is scripts/exec-server.cjs; this file starts and stops it,
// loads the repository into it, and pulls the final patch back out.
//
// Backends, chosen by OPENSRCER_EXEC:
//   auto (default)  docker when the daemon answers, else off (logged loudly)
//   docker          a throwaway container: non-root, no capabilities, no host
//                   mounts besides the read-only server script, port bound to
//                   127.0.0.1. Credentials never enter it.
//   host            explicit opt-in for single-user machines: the server runs
//                   as a host process with a scrubbed env. NOT a boundary:
//                   same-user code can read other processes and ~/ files.
//   remote          hosted: the web app created a separate exec VM and passed
//                   its URL + token (OPENSRCER_EXEC_URL / _TOKEN).
//   off             today's text-diff path, unverified.
//
// The repository enters as a tarball of the pinned commit (git archive of
// the trusted cache clone); the patch leaves as text and goes through the
// same apply/containment/gitleaks gates as a model-typed diff. Host-side Git
// never runs inside a directory box code has written to.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { execLimits } from "./limits";

const execFileAsync = promisify(execFile);

export type ExecMode = "docker" | "host" | "remote" | "off";

export type ExecBox = {
  mode: Exclude<ExecMode, "off">;
  url: string;
  token: string;
  /** Idempotent. Tears the box down; remote boxes are stopped by the web app. */
  stop: () => Promise<void>;
};

/** A box request failed: carries the box's own message, never a credential. */
export class ExecBoxError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ExecBoxError";
  }
}

export const EXEC_SERVER_SCRIPT = path.join(process.cwd(), "scripts", "exec-server.cjs");
const BOX_PORT = 7070;

/** Resolve OPENSRCER_EXEC. `auto` probes Docker once per process. */
let dockerProbe: Promise<boolean> | null = null;
export async function resolveExecMode(env: Record<string, string | undefined> = process.env): Promise<{ mode: ExecMode; reason: string }> {
  const raw = (env.OPENSRCER_EXEC ?? "auto").trim().toLowerCase();
  if (raw === "off" || raw === "0") return { mode: "off", reason: "OPENSRCER_EXEC=off" };
  if (raw === "host") return { mode: "host", reason: "OPENSRCER_EXEC=host (single-user opt-in, not isolated)" };
  if (raw === "docker") return { mode: "docker", reason: "OPENSRCER_EXEC=docker" };
  if (raw === "remote") {
    return env.OPENSRCER_EXEC_URL && env.OPENSRCER_EXEC_TOKEN
      ? { mode: "remote", reason: "exec VM provided by the web app" }
      : { mode: "off", reason: "OPENSRCER_EXEC=remote without OPENSRCER_EXEC_URL/TOKEN" };
  }
  if (raw !== "auto") throw new ExecBoxError(`OPENSRCER_EXEC must be auto, docker, host, remote or off (got "${raw}")`);
  dockerProbe ??= execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], { env: dockerEnv(), timeout: 10_000, windowsHide: true })
    .then(() => true, () => false);
  return (await dockerProbe)
    ? { mode: "docker", reason: "OPENSRCER_EXEC=auto, Docker available" }
    : { mode: "off", reason: "OPENSRCER_EXEC=auto and Docker is unavailable" };
}

function dockerEnv(): NodeJS.ProcessEnv {
  return childEnv({ DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, DOCKER_CONFIG: process.env.DOCKER_CONFIG });
}

/** Where `docker cp` puts the server script inside a created box. /opt is
 *  root-owned, so the box's `node` user cannot rewrite it. */
const BOX_SCRIPT = "/opt/opensrcer-exec-server.cjs";

/** Docker create arguments for one box. Exported for tests: the isolation
 *  flags are the security property, so they are asserted, not assumed.
 *  Nothing from the host is bind-mounted: the server script is copied in
 *  (startExecBox), so a host drive Docker cannot share never breaks a run. */
export function dockerCreateArgs(name: string, token: string, cacheVolume?: string, envVolume?: string): string[] {
  const limits = execLimits();
  // Package caches (uv, pip, yarn) survive between runs of the SAME repository
  // only: a repository's code can write into its cache, so sharing one cache
  // across repositories would let one poison another's installs. The env
  // volume holds the installed environment (a venv) for one repository and
  // one lockfile hash, so a later run of the same revision starts warm.
  const cache = cacheVolume && /^opensrcer-cache-[a-z0-9_.-]{1,180}$/.test(cacheVolume) ? ["-v", `${cacheVolume}:/home/node/.cache`] : [];
  const env = envVolume && /^opensrcer-env-[a-z0-9_.-]{1,180}$/.test(envVolume) ? ["-v", `${envVolume}:/home/node/env`] : [];
  return [
    "create", "--rm", "--name", name,
    "--init",
    "-p", `127.0.0.1::${BOX_PORT}`,
    "--memory", limits.memory, "--cpus", limits.cpus, "--pids-limit", "4096",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--user", "node",
    // Docker Desktop resolves host.docker.internal to the host. Pin it to the
    // box's own loopback so repository code cannot reach host-only services
    // under that name.
    "--add-host", "host.docker.internal:127.0.0.1",
    "-e", `EXEC_TOKEN=${token}`,
    "-e", `EXEC_CMD_TIMEOUT_MS=${limits.cmdTimeoutMs}`,
    "-e", `EXEC_TOTAL_MS=${limits.totalMs}`,
    "-e", `EXEC_OUTPUT_BYTES=${limits.outputBytes}`,
    "-e", `EXEC_MAX_LIFETIME_MS=${limits.maxLifetimeMs}`,
    "-e", `EXEC_SETUP_MS=${limits.setupMs}`,
    ...cache,
    ...env,
    limits.image,
    "node", BOX_SCRIPT,
  ];
}

/** Start a box for one dispatch. `workDir` is the dispatch's scratch dir
 *  (host backend only). Throws ExecBoxError when the box cannot start. */
export async function startExecBox(mode: Exclude<ExecMode, "off">, dispatchId: string, workDir: string, repoFull?: string, envKey?: string): Promise<ExecBox> {
  if (mode === "remote") {
    const url = process.env.OPENSRCER_EXEC_URL!, token = process.env.OPENSRCER_EXEC_TOKEN!;
    // The worker removes these from its own env once read, so the agent's
    // child env carries them only where the dispatcher injects them.
    return { mode, url, token, stop: async () => {} };
  }
  const token = randomBytes(32).toString("hex");
  if (mode === "docker") {
    const name = `opensrcer-exec-${dispatchId.replace(/[^A-Za-z0-9_.-]/g, "-").slice(-40)}`;
    const env = dockerEnv();
    const docker = (args: string[], timeout = 120_000) => execFileAsync("docker", args, { env, timeout, windowsHide: true });
    try {
      const cache = repoFull && process.env.OPENSRCER_EXEC_CACHE !== "0" ? `opensrcer-cache-${repoFull.toLowerCase().replace(/[^a-z0-9_.-]/g, "_")}` : undefined;
      const envVolume = repoFull && envKey ? `opensrcer-env-${repoFull.toLowerCase().replace(/[^a-z0-9_.-]/g, "_")}-${envKey}` : undefined;
      await docker(dockerCreateArgs(name, token, cache, envVolume));
      await docker(["cp", EXEC_SERVER_SCRIPT, `${name}:${BOX_SCRIPT}`], 60_000);
      await docker(["start", name], 60_000);
    } catch (error) {
      await docker(["rm", "-f", name], 60_000).catch(() => {});
      // Docker's own stderr says why; the message is mostly the echoed command
      // line, and callers truncate it, so the reason must come first.
      const stderr = String((error as { stderr?: unknown })?.stderr ?? "").trim();
      const reason = stderr || (error instanceof Error ? error.message : String(error));
      throw new ExecBoxError(`docker run failed: ${redactToken(reason, token)}`);
    }
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      await execFileAsync("docker", ["rm", "-f", name], { env, timeout: 60_000, windowsHide: true }).catch(() => {});
    };
    try {
      const { stdout } = await execFileAsync("docker", ["port", name, String(BOX_PORT)], { env, timeout: 30_000, windowsHide: true });
      const port = /127\.0\.0\.1:(\d+)/.exec(stdout)?.[1];
      if (!port) throw new ExecBoxError("docker did not publish the box port");
      const box: ExecBox = { mode, url: `http://127.0.0.1:${port}`, token, stop };
      await waitHealthy(box);
      return box;
    } catch (error) {
      await stop();
      throw error instanceof ExecBoxError ? error : new ExecBoxError(`box did not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return startHostBox(token, workDir);
}

async function startHostBox(token: string, workDir: string): Promise<ExecBox> {
  const limits = execLimits();
  const root = path.join(workDir, "box");
  const home = path.join(workDir, "box-home");
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  // Scrubbed env (no credentials) with HOME/TMP moved into the run dir, so
  // tools do not pick up the user's ~/.npmrc, ~/.pypirc, gh or git config by
  // default. Absolute paths stay readable: this backend is opt-in for a
  // reason.
  const env = childEnv({
    HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home,
    EXEC_TOKEN: token, EXEC_ROOT: root, EXEC_HOST: "127.0.0.1", EXEC_PORT: "0",
    EXEC_CMD_TIMEOUT_MS: String(limits.cmdTimeoutMs), EXEC_TOTAL_MS: String(limits.totalMs),
    EXEC_OUTPUT_BYTES: String(limits.outputBytes), EXEC_MAX_LIFETIME_MS: String(limits.maxLifetimeMs),
  });
  for (const key of ["APPDATA", "LOCALAPPDATA"]) delete env[key];
  const child = spawn(process.execPath, [EXEC_SERVER_SCRIPT], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stop = async () => { killTree(child); };
  try {
    const port = await new Promise<string>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new ExecBoxError("host box did not start within 15s")), 15_000);
      child.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const m = /ready on [^:\s]+:(\d+)/.exec(out);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on("exit", (code) => { clearTimeout(timer); reject(new ExecBoxError(`host box exited (${code})`)); });
    });
    child.stdout!.resume();
    child.stderr!.resume();
    const box: ExecBox = { mode: "host", url: `http://127.0.0.1:${port}`, token, stop };
    await waitHealthy(box);
    return box;
  } catch (error) {
    await stop();
    throw error;
  }
}

function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") execFile("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true }, () => {});
  else child.kill("SIGKILL");
}

function redactToken(message: string, token: string): string {
  return message.split(token).join("[redacted]");
}

/** Poll /health until the box answers (about 10 s). Exported for the hosted
 *  exec VM (lib/cloud-exec.ts). */
export async function waitHealthy(box: Pick<ExecBox, "url" | "token">): Promise<void> {
  let last = "";
  for (let i = 0; i < 40; i++) {
    try {
      await boxRequest(box, "GET", "/health", undefined, 5_000);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new ExecBoxError(`box never became healthy: ${last}`);
}

/** One request to the box. JSON bodies, or a readable stream for /init. */
export function boxRequest<T = Record<string, unknown>>(
  box: Pick<ExecBox, "url" | "token">,
  method: "GET" | "POST",
  route: string,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<T> {
  const url = new URL(route, box.url);
  const stream = body && typeof (body as NodeJS.ReadableStream).pipe === "function" ? body as NodeJS.ReadableStream : null;
  const payload = stream || body === undefined ? null : Buffer.from(JSON.stringify(body));
  const client = url.protocol === "https:" ? https : http;
  return new Promise<T>((resolve, reject) => {
    const req = client.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${box.token}`,
        // The hosted port route buffers responses it may compress; ask for
        // none so /run heartbeats stream (lib/cloud-exec.ts).
        "Accept-Encoding": "identity",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        ...(stream ? { "Content-Type": "application/gzip" } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024 * 1024) { req.destroy(new ExecBoxError("box response too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { reject(new ExecBoxError(`box returned non-JSON (HTTP ${res.statusCode})`, res.statusCode)); return; }
        // A streamed answer (/run) reports a late failure as 200 + {error}.
        if (res.statusCode !== 200 || typeof parsed.error === "string") reject(new ExecBoxError(String(parsed.error ?? `HTTP ${res.statusCode}`), res.statusCode));
        else resolve(parsed as T);
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new ExecBoxError(`box request ${route} timed out after ${Math.round(timeoutMs / 1000)}s`)));
    req.on("error", (error) => reject(error instanceof ExecBoxError ? error : new ExecBoxError(`box unreachable: ${error.message}`)));
    if (stream) stream.pipe(req);
    else req.end(payload ?? undefined);
  });
}

/** Load the pinned commit of the trusted cache clone into the box. The
 *  archive is taken from the object store, not the working tree, and with
 *  export-ignore/export-subst disabled so the box sees exactly the tracked
 *  files (some repos export-ignore their tests). */
export async function initBox(box: ExecBox, cloneDir: string, sha: string, sparseDirs?: string[] | null): Promise<{ baseline: string }> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new ExecBoxError("initBox needs a full commit SHA");
  const infoDir = path.join(cloneDir, ".git", "info");
  mkdirSync(infoDir, { recursive: true });
  writeFileSync(path.join(infoDir, "attributes"), "* -export-ignore -export-subst\n");
  // A sparse partial clone has no blobs outside its cone; archiving them
  // would fetch each one lazily. Archive the cone (and root files) only.
  const pathspecs = sparseDirs?.length ? ["--", ":(glob)*", ...sparseDirs] : [];
  // git archive applies working-tree EOL conversion; with Git for Windows'
  // autocrlf every file would reach the Linux box with CRLF (seen: edits
  // failed to match and diffs would carry \r). Blobs go in byte-exact.
  const git = spawn("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "-C", cloneDir, "archive", "--format=tar.gz", sha, ...pathspecs], { env: childEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  git.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-2000); });
  const exited = new Promise<number | null>((resolve) => git.on("close", resolve));
  try {
    const result = await boxRequest<{ baseline: string }>(box, "POST", "/init", git.stdout, execLimits().cmdTimeoutMs);
    if ((await exited) !== 0) throw new ExecBoxError(`git archive failed: ${stderr}`);
    return result;
  } catch (error) {
    killTree(git);
    throw error;
  }
}

export type RunResult = {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  duration_ms: number;
  output: string;
  truncated: boolean;
};

/** Run a command in the box. `verify` marks the host's own verification
 *  re-runs, which do not draw on the agent's command budget. */
export function runInBox(box: ExecBox, command: string, timeoutMs?: number, verify = false, setup = false): Promise<RunResult> {
  // The HTTP wait outlives the command's own timeout so the box reports it.
  const limits = execLimits();
  const wait = (timeoutMs ?? (setup ? limits.setupMs : limits.cmdTimeoutMs)) + 60_000;
  return boxRequest<RunResult>(box, "POST", "/run", { command, verify, setup, ...(timeoutMs ? { timeout_ms: timeoutMs } : {}) }, wait);
}

/** The box's patch against its baseline: `git diff` of what the agent did. */
export async function boxPatch(box: ExecBox): Promise<string> {
  return (await boxRequest<{ patch: string }>(box, "POST", "/diff", {}, 5 * 60_000)).patch;
}
