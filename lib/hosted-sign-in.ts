// Hosted Claude subscription runs: the user signs in to the unmodified Claude
// Code CLI inside the run's own disposable VM, through Anthropic's own flow.
//
//   1. The worker starts `claude auth login --claudeai` with a fresh
//      CLAUDE_CONFIG_DIR. The CLI prints a claude.com authorize URL whose
//      redirect is Anthropic's code page (platform.claude.com/oauth/code/callback).
//   2. Only that URL goes to the run page. The user signs in on claude.com,
//      and Anthropic's page shows them a one-time code.
//   3. The user pastes the code on the run page. The app writes it into this
//      VM (sandbox.writeFiles, straight to the VM's filesystem); the worker
//      reads it, deletes the file, and types it into the CLI's stdin. The code
//      is never logged, published, or stored anywhere else.
//   4. The login lives in the VM's config dir and dies with the VM; the
//      worker also logs out (which revokes it) when the run ends.
//
// Gated by OPENSRCER_HOSTED_SUBSCRIPTION=1 (lib/run-payment.ts).

import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Where the app drops the pasted code inside the VM. */
export const SIGN_IN_CODE_DIR = "/tmp/opensrcer-sign-in";
export const SIGN_IN_CODE_PATH = `${SIGN_IN_CODE_DIR}/code`;

export type SignInState = { url: string; status: "waiting" | "signed_in" | "failed" };

/** The sign-in failed or timed out. Its message is safe to show. */
export class HostedSignInError extends Error {}

// Anthropic's authorize endpoints. A worker can rewrite its own run record,
// so the run page only ever links to these, never to an arbitrary URL.
const SIGN_IN_URL = /^https:\/\/(claude\.com\/cai\/oauth\/authorize|claude\.ai\/oauth\/authorize)\?[\x21-\x7e]{1,1900}$/;

export function validSignInUrl(value: unknown): value is string {
  return typeof value === "string" && SIGN_IN_URL.test(value);
}

export function validSignInState(value: unknown): value is SignInState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<SignInState>;
  return validSignInUrl(state.url) && (state.status === "waiting" || state.status === "signed_in" || state.status === "failed");
}

/** First Anthropic authorize URL in CLI output, or null. */
export function extractSignInUrl(output: string): string | null {
  const clean = output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  const match = /https:\/\/(?:claude\.com\/cai|claude\.ai)\/oauth\/authorize\?[^\s"'<>]+/.exec(clean)?.[0] ?? null;
  return match && validSignInUrl(match) ? match : null;
}

/** Codes look like "<code>#<state>"; refuse anything that could carry a
 *  second line or a control sequence into the CLI's stdin. */
export function validSignInCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~#-]{8,1024}$/.test(value);
}

/** Take the pasted code if it has arrived, deleting it at once. */
export function takeSignInCode(path = SIGN_IN_CODE_PATH): string | null {
  let code: string;
  try { code = readFileSync(path, "utf8").trim(); } catch { return null; }
  rmSync(path, { force: true });
  return code;
}

/** Run `claude auth login` in this VM, report its URL, relay the code, and
 *  resolve once the CLI says the login completed. */
export function signInInVm(opts: {
  bin: string;
  /** Leading arguments before `auth login` (tests run a stub CLI through node). */
  args?: string[];
  env: NodeJS.ProcessEnv;
  onUrl: (url: string) => void | Promise<void>;
  takeCode?: () => string | null;
  timeoutMs: number;
}): Promise<void> {
  const takeCode = opts.takeCode ?? (() => takeSignInCode());
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin, [...(opts.args ?? []), "auth", "login", "--claudeai"], { env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new StringDecoder("utf8");
    let output = "";
    let urlSent = false;
    let succeeded = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: Buffer) => {
      // Only enough output to find the URL and the CLI's status; never the code.
      output = (output + decoder.write(chunk)).slice(-20_000);
      const url = urlSent ? null : extractSignInUrl(output);
      if (url) {
        urlSent = true;
        Promise.resolve(opts.onUrl(url)).catch(() => finish(new HostedSignInError("Could not show the sign-in link. Retry the run.")));
      }
      // The CLI may wait for Enter after "Login successful"; give it one and
      // a moment to exit. The caller confirms with `claude auth status`.
      if (!succeeded && /login successful/i.test(output)) {
        succeeded = true;
        child.stdin.write("\n");
        setTimeout(() => finish(), 10_000).unref();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    // Writing after the CLI exits (EPIPE) is not a failure; `close` decides.
    child.stdin.on("error", () => {});
    const poll = setInterval(() => {
      if (!urlSent) return;
      const code = takeCode();
      if (code === null) return;
      if (!validSignInCode(code)) return finish(new HostedSignInError("That sign-in code is not valid. Retry the run and paste the code exactly as shown."));
      child.stdin.write(`${code}\n`);
    }, 1000);
    const deadline = setTimeout(() => finish(new HostedSignInError("Sign-in was not completed in time. Retry the run when you are ready to sign in.")), opts.timeoutMs);
    child.on("error", () => finish(new HostedSignInError("The Claude CLI could not start in the worker.")));
    child.on("close", (code) => {
      if (code === 0 || succeeded) finish();
      else finish(new HostedSignInError(/login failed/i.test(output)
        ? "Claude did not accept that sign-in code. Retry the run and paste a fresh code."
        : "Claude sign-in did not complete. Retry the run."));
    });
  });
}
