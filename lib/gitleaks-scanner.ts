// Gitleaks secret scanner. Scans a directory for hardcoded secrets
// (API keys, passwords, tokens) before the agent opens a PR.
// Returns structured results so the caller can gate PR creation:
// if secrets are found, block the PR.
//
// Uses `gitleaks dir <path>` (no git history scan — we only care about
// the current working tree state after the patch is applied).

import { execFile } from "node:child_process";
import { childEnv } from "./child-env";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LeakFinding = {
  ruleId: string;
  description: string;
  file: string;
  startLine: number;
  endLine: number;
  match: string;
  entropy: number;
  fingerprint: string;
};

export type ScanStatus = "clean" | "leaks_found" | "error" | "skipped";

export type ScanResult = {
  status: ScanStatus;
  findings: LeakFinding[];
  findingCount: number;
  durationMs: number;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 60 * 1000; // 1 minute

function resolveGitleaksBin(): string | null {
  // 1. Check PATH
  const names = process.platform === "win32" ? ["gitleaks.exe", "gitleaks"] : ["gitleaks"];
  for (const name of names) {
    try {
      require("node:child_process").execFileSync(name, ["version"], {
        stdio: "pipe",
        timeout: 5000,
      });
      return name;
    } catch {
      // not on PATH
    }
  }

  // 2. Check winget install location
  if (process.platform === "win32") {
    const wingetPath = join(
      homedir(),
      "AppData",
      "Local",
      "Microsoft",
      "WinGet",
      "Packages",
      "Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "gitleaks.exe",
    );
    if (existsSync(wingetPath)) return wingetPath;
  }

  return null;
}

export async function scanSecrets(
  dir: string,
  opts: { timeoutMs?: number } = {},
): Promise<ScanResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  const bin = resolveGitleaksBin();
  if (!bin) {
    return {
      status: "skipped",
      findings: [],
      findingCount: 0,
      durationMs: Date.now() - start,
      reason: "gitleaks not installed",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        "dir",
        dir,
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--no-banner",
        "--no-color",
        "--exit-code",
        "1",
      ],
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        // The scanner reads a directory; it needs no credentials, so it
        // gets none. See lib/child-env.ts.
        env: childEnv(),
      },
    );

    // Exit code 0 = no leaks
    return {
      status: "clean",
      findings: [],
      findingCount: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    // Exit code 1 = leaks found, stdout has JSON
    if (e.code === 1 && e.stdout) {
      try {
        const raw = JSON.parse(e.stdout) as Array<{
          RuleID: string;
          Description: string;
          File: string;
          StartLine: number;
          EndLine: number;
          Match: string;
          Entropy: number;
          Fingerprint: string;
        }>;

        const findings: LeakFinding[] = raw.map((f) => ({
          ruleId: f.RuleID,
          description: f.Description,
          file: f.File,
          startLine: f.StartLine,
          endLine: f.EndLine,
          // Redact the actual secret value — show only first/last 4 chars
          match: redact(f.Match),
          entropy: f.Entropy,
          fingerprint: f.Fingerprint,
        }));

        return {
          status: "leaks_found",
          findings,
          findingCount: findings.length,
          durationMs: Date.now() - start,
        };
      } catch {
        // JSON parse failed — treat as error
      }
    }

    // Timeout
    if (e.killed) {
      return {
        status: "error",
        findings: [],
        findingCount: 0,
        durationMs: Date.now() - start,
        reason: `gitleaks timed out after ${timeout}ms`,
      };
    }

    return {
      status: "error",
      findings: [],
      findingCount: 0,
      durationMs: Date.now() - start,
      reason: e.stderr?.slice(0, 300) || String(err),
    };
  }
}

export function formatLogBlock(result: ScanResult): string {
  const lines: string[] = [];
  lines.push("[gitleaks] ─────────────────────────────");
  lines.push(`[gitleaks] status=${result.status}`);
  lines.push(`[gitleaks] findings=${result.findingCount}`);
  lines.push(`[gitleaks] durationMs=${result.durationMs}`);
  if (result.reason) lines.push(`[gitleaks] reason=${result.reason}`);

  for (const f of result.findings.slice(0, 10)) {
    lines.push(
      `[gitleaks] LEAK: ${f.ruleId} in ${f.file}:${f.startLine} — ${f.description}`,
    );
  }
  if (result.findingCount > 10) {
    lines.push(`[gitleaks] ... and ${result.findingCount - 10} more`);
  }

  lines.push("[gitleaks] ─────────────────────────────");
  return lines.join("\n") + "\n";
}

function redact(secret: string): string {
  if (secret.length <= 8) return "***";
  return secret.slice(0, 4) + "..." + secret.slice(-4);
}
