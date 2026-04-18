// Sandbox test runner. Given a worktree on disk, detect the repo's
// ecosystem and run its tests. Returns a structured result the caller
// can gate PR creation on: if tests pass, proceed; if fail, skip push.
//
// MVP: runs in the worktree directly, no container isolation. The
// worktree is already a throwaway checkout off the cached shallow clone,
// so the blast radius is bounded to that directory. Future: flip on
// CRUCIBLE_SANDBOX_DOCKER=1 to wrap commands in `docker run --rm -v`.
//
// Ecosystem priority (first match wins):
//   1. package.json with scripts.test  → npm ci && npm test
//   2. pyproject.toml or requirements*.txt → pip install + pytest
//   3. go.mod                           → go test ./...
//   4. Cargo.toml                       → cargo test
//
// If no ecosystem matches, `status` is "skipped" and the caller should
// treat that as neither pass nor fail. The CRUCIBLE design explicitly
// permits surfacing "no tests — no verification" rather than faking a
// green check.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type TestStatus = "passed" | "failed" | "error" | "skipped";

export type TestResult = {
  status: TestStatus;
  ecosystem: string | null;
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB stdout / stderr cap

type Ecosystem = {
  name: string;
  detect: (dir: string) => boolean;
  // Ordered list of shell-free command specs. Each runs in sequence;
  // first non-zero exit aborts and is reported as the failure.
  commands: Array<{ cmd: string; args: string[]; label: string }>;
};

function hasFile(dir: string, rel: string): boolean {
  return existsSync(path.join(dir, rel));
}

function packageJsonHasTestScript(dir: string): boolean {
  const p = path.join(dir, "package.json");
  if (!existsSync(p)) return false;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return Boolean(parsed.scripts?.test && parsed.scripts.test.trim().length > 0);
  } catch {
    return false;
  }
}

function hasRequirementsFile(dir: string): boolean {
  // requirements.txt / requirements-dev.txt / etc.
  try {
    // Cheap check — only look at common names.
    const candidates = [
      "requirements.txt",
      "requirements-dev.txt",
      "requirements-test.txt",
      "dev-requirements.txt",
      "test-requirements.txt",
    ];
    return candidates.some((n) => hasFile(dir, n));
  } catch {
    return false;
  }
}

const ECOSYSTEMS: Ecosystem[] = [
  {
    name: "npm",
    detect: (dir) => packageJsonHasTestScript(dir),
    commands: [
      // `npm ci` if package-lock exists, else `npm install`. We can't
      // branch in the spec cleanly, so we use `npm install --no-audit
      // --no-fund` which works in both cases (slightly slower than ci).
      { cmd: "npm", args: ["install", "--no-audit", "--no-fund"], label: "npm install" },
      { cmd: "npm", args: ["test", "--silent"], label: "npm test" },
    ],
  },
  {
    name: "pytest",
    detect: (dir) => hasFile(dir, "pyproject.toml") || hasRequirementsFile(dir),
    commands: [
      // Try a dev install; if it fails (no setup.py/pyproject with build
      // backend), fall through and still try pytest. We accept failure
      // on this step by translating its exit into a note, not an abort.
      { cmd: "pip", args: ["install", "-e", ".[dev,test]"], label: "pip install -e .[dev,test] (best-effort)" },
      { cmd: "pytest", args: ["-x", "-q"], label: "pytest -x -q" },
    ],
  },
  {
    name: "go",
    detect: (dir) => hasFile(dir, "go.mod"),
    commands: [
      { cmd: "go", args: ["test", "./..."], label: "go test ./..." },
    ],
  },
  {
    name: "cargo",
    detect: (dir) => hasFile(dir, "Cargo.toml"),
    commands: [
      { cmd: "cargo", args: ["test", "--no-fail-fast"], label: "cargo test" },
    ],
  },
];

function detectEcosystem(dir: string): Ecosystem | null {
  for (const eco of ECOSYSTEMS) {
    if (eco.detect(dir)) return eco;
  }
  return null;
}

// Spawn + collect bounded output. Returns {exitCode, stdout, stderr, timedOut}.
async function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      // shell: true needed for PATH resolution of npm/pip/go/cargo on
      // Windows (npm is npm.cmd, not npm.exe) and is harmless here —
      // every cmd + args tuple is a whitelisted constant (see
      // ECOSYSTEMS). No user-controlled input reaches the shell.
      shell: true,
    });

    const appendBounded = (buf: string, chunk: string): string => {
      if (buf.length >= MAX_OUTPUT_BYTES) return buf;
      const room = MAX_OUTPUT_BYTES - buf.length;
      return buf + chunk.slice(0, room);
    };

    child.stdout?.on("data", (d) => {
      stdout = appendBounded(stdout, d.toString());
    });
    child.stderr?.on("data", (d) => {
      stderr = appendBounded(stderr, d.toString());
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: false,
        spawnError: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

export async function runTests(
  worktreeDir: string,
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<TestResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const eco = detectEcosystem(worktreeDir);
  if (!eco) {
    return {
      status: "skipped",
      ecosystem: null,
      command: null,
      exitCode: null,
      durationMs: Date.now() - started,
      stdout: "",
      stderr: "",
      reason: "no recognized ecosystem (package.json with test script / pyproject.toml / go.mod / Cargo.toml)",
    };
  }

  let stdoutAll = "";
  let stderrAll = "";
  let lastCommand: string | null = null;

  for (let i = 0; i < eco.commands.length; i++) {
    const step = eco.commands[i];
    const isLastStep = i === eco.commands.length - 1;
    lastCommand = step.label;

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      return {
        status: "failed",
        ecosystem: eco.name,
        command: step.label,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout: stdoutAll,
        stderr: stderrAll,
        reason: `timed out before running ${step.label}`,
      };
    }

    stdoutAll += `\n── ${step.label} ──\n`;
    stderrAll += `\n── ${step.label} ──\n`;

    const res = await runCommand(step.cmd, step.args, {
      cwd: worktreeDir,
      timeoutMs: remaining,
      env: opts.env,
    });

    stdoutAll += res.stdout;
    stderrAll += res.stderr;

    if (res.spawnError) {
      // spawn failure on intermediate steps — for pytest's best-effort
      // pip install, we tolerate and move on. For the test step itself
      // we report error.
      if (!isLastStep && eco.name === "pytest" && step.cmd === "pip") {
        stderrAll += `\n(pip step failed: ${res.spawnError} — continuing to pytest)\n`;
        continue;
      }
      return {
        status: "error",
        ecosystem: eco.name,
        command: step.label,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout: stdoutAll,
        stderr: stderrAll,
        reason: `spawn failed: ${res.spawnError}`,
      };
    }

    if (res.timedOut) {
      return {
        status: "failed",
        ecosystem: eco.name,
        command: step.label,
        exitCode: res.exitCode,
        durationMs: Date.now() - started,
        stdout: stdoutAll,
        stderr: stderrAll,
        reason: `timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    if (res.exitCode !== 0) {
      // pytest's pip best-effort: if pip failed but pytest isn't next,
      // continue; if this IS the test step (isLastStep), fail.
      if (!isLastStep && eco.name === "pytest" && step.cmd === "pip") {
        stderrAll += `\n(pip exited ${res.exitCode} — continuing to pytest)\n`;
        continue;
      }
      return {
        status: "failed",
        ecosystem: eco.name,
        command: step.label,
        exitCode: res.exitCode,
        durationMs: Date.now() - started,
        stdout: stdoutAll,
        stderr: stderrAll,
        reason: `${step.label} exited ${res.exitCode}`,
      };
    }
  }

  return {
    status: "passed",
    ecosystem: eco.name,
    command: lastCommand,
    exitCode: 0,
    durationMs: Date.now() - started,
    stdout: stdoutAll,
    stderr: stderrAll,
  };
}

// Single-line log markers the dispatcher's enrichWithPrStatus scans for.
// Keep these stable — the UI depends on them.
export function formatLogBlock(result: TestResult): string {
  const lines: string[] = [];
  lines.push("[crucible-tests] ─────────────────────────────");
  lines.push(`[crucible-tests] status=${result.status}`);
  lines.push(`[crucible-tests] ecosystem=${result.ecosystem ?? "none"}`);
  if (result.command) lines.push(`[crucible-tests] command=${result.command}`);
  lines.push(`[crucible-tests] durationMs=${result.durationMs}`);
  if (result.exitCode !== null) lines.push(`[crucible-tests] exitCode=${result.exitCode}`);
  if (result.reason) lines.push(`[crucible-tests] reason=${result.reason}`);
  // Bounded output tail for debugging — head of each stream.
  const tailBytes = 4096;
  if (result.stdout) {
    const tail = result.stdout.slice(-tailBytes);
    lines.push(`[crucible-tests] stdout-tail (${result.stdout.length}B):`);
    lines.push(tail);
  }
  if (result.stderr) {
    const tail = result.stderr.slice(-tailBytes);
    lines.push(`[crucible-tests] stderr-tail (${result.stderr.length}B):`);
    lines.push(tail);
  }
  lines.push("[crucible-tests] ─────────────────────────────");
  return lines.join("\n") + "\n";
}
