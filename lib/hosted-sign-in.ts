// Hosted Claude subscription runs: the user signs in to the unmodified Claude
// Code CLI inside the run's own disposable VM, through Anthropic's own flow,
// in a plain web terminal (PLAN.md §0.6, reports/Using AI subscriptions safely.md).
//
//   1. The worker starts `claude auth login --claudeai` on a pseudo-terminal
//      (util-linux `script`) with a fresh CLAUDE_CONFIG_DIR, and serves that
//      terminal on SIGN_IN_TTY_PORT behind a per-run bearer token.
//   2. The run page shows an xterm.js terminal; the app proxies its bytes to
//      and from this VM as an opaque stream (lib/cloud-runs.ts
//      proxySignInTerminal). The user opens Claude Code's own sign-in link and
//      pastes the code into Claude Code's own prompt, exactly as over SSH.
//   3. The worker learns the outcome only from `claude auth status`
//      (`signedIn`), never from the terminal's bytes.
//   4. The login lives in the VM's config dir and dies with the VM; the
//      worker also logs out (which revokes it) when the run ends.
//
// Compliance: no code here or in the app parses, logs, stores or inspects
// what passes through the terminal. Output is piped to the one attached
// viewer; input is piped to the CLI. A request body is only counted, to cap
// its size.
//
// Gated by OPENSRCER_HOSTED_SUBSCRIPTION=1 (lib/run-payment.ts).

import { spawn } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";

/** The agent VM port the sign-in terminal listens on (exposed only for
 *  claude-subscription runs). */
export const SIGN_IN_TTY_PORT = 7071;
/** The terminal's fixed size; the browser terminal uses the same.
 *  ponytail: no resize; add a resize message if the fixed size gets in the way. */
export const TTY_COLS = 100;
export const TTY_ROWS = 30;
/** Largest single input request (a pasted sign-in code is well under 2 KB). */
export const MAX_TTY_INPUT_BYTES = 64 * 1024;

export type SignInState = { status: "waiting" | "signed_in" | "failed" };

/** The sign-in failed or timed out. Its message is safe to show. */
export class HostedSignInError extends Error {}

/** Records written before the terminal also carried a `url`; it is ignored. */
export function validSignInState(value: unknown): value is SignInState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = (value as Partial<SignInState>).status;
  return status === "waiting" || status === "signed_in" || status === "failed";
}

/** A terminal capability: 32 bytes in hex (lib/cloud-runs.ts signInTtyToken). */
export function validTtyToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Run a command on a pseudo-terminal of the fixed size, so Claude Code draws
 *  its normal interactive prompt. util-linux `script` allocates the pty with
 *  no native module; -e passes the command's exit code through. */
export function ptyCommand(bin: string, args: string[]): { bin: string; args: string[] } {
  const quoted = [bin, ...args].map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ");
  return { bin: "script", args: ["-qfec", `stty cols ${TTY_COLS} rows ${TTY_ROWS} 2>/dev/null; exec ${quoted}`, "/dev/null"] };
}

/** Serve `command`'s terminal on `port` until `signedIn()` says the login
 *  exists. Resolves once signed in; rejects with HostedSignInError on a
 *  timeout or when the CLI exits without a login.
 *
 *  GET  /tty   the terminal's output, streamed. One viewer at a time; a new
 *              GET (a reconnect) takes over. Output waits in the pipe while
 *              nobody is attached, so nothing is lost or kept by us.
 *  POST /tty   bytes to type into the terminal. */
export function serveSignInTerminal(opts: {
  command: { bin: string; args: string[] };
  env: NodeJS.ProcessEnv;
  token: string;
  port: number;
  host?: string;
  signedIn: () => Promise<boolean>;
  timeoutMs: number;
  pollMs?: number;
  /** The bound port (tests listen on port 0). */
  onListening?: (port: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!validTtyToken(opts.token)) {
      reject(new HostedSignInError("The sign-in terminal is not configured for this run. Retry the run."));
      return;
    }
    const expected = Buffer.from(`Bearer ${opts.token}`);
    const child = spawn(opts.command.bin, opts.command.args, { env: opts.env, stdio: ["pipe", "pipe", "ignore"] });
    // Writing after the CLI exits (EPIPE) is not a failure; the exit decides.
    child.stdin.on("error", () => {});
    let viewer: ServerResponse | null = null;
    const detach = () => {
      if (viewer) {
        child.stdout.unpipe(viewer);
        viewer.end();
        viewer = null;
      }
      child.stdout.pause();
    };

    const server = createServer((req, res) => {
      const auth = Buffer.from(req.headers.authorization ?? "");
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
        req.resume();
        res.writeHead(401).end();
        return;
      }
      if (req.url !== "/tty") {
        req.resume();
        res.writeHead(404).end();
        return;
      }
      if (req.method === "GET") {
        detach();
        res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
        res.flushHeaders();
        viewer = res;
        child.stdout.pipe(res, { end: false });
        res.on("close", () => { if (viewer === res) detach(); });
        return;
      }
      if (req.method === "POST") {
        let size = 0;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_TTY_INPUT_BYTES) {
            req.destroy();
            return;
          }
          child.stdin.write(chunk);
        });
        req.on("end", () => res.writeHead(204).end());
        return;
      }
      req.resume();
      res.writeHead(405).end();
    });

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
      detach();
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve();
    };
    let checking = false;
    const poll = setInterval(() => {
      if (checking) return;
      checking = true;
      // The CLI may wait for Enter after it signs in; the status is the truth.
      opts.signedIn().then((yes) => { if (yes) finish(); }, () => {}).finally(() => { checking = false; });
    }, opts.pollMs ?? 3000);
    const deadline = setTimeout(() => finish(new HostedSignInError("Sign-in was not completed in time. Retry the run when you are ready to sign in.")), opts.timeoutMs);
    child.on("error", () => finish(new HostedSignInError("The Claude CLI could not start in the worker.")));
    // `exit`, not `close`: output nobody has read yet keeps stdout open.
    child.on("exit", () => {
      opts.signedIn().catch(() => false).then((yes) =>
        finish(yes ? undefined : new HostedSignInError("Claude sign-in did not complete. Retry the run.")));
    });
    server.on("error", () => finish(new HostedSignInError("The sign-in terminal could not start in the worker.")));
    server.listen(opts.port, opts.host ?? "0.0.0.0", () => opts.onListening?.((server.address() as AddressInfo).port));
  });
}
