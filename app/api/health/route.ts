// GET /api/health — liveness + a truthful readiness picture.
//
// This used to return seeded fake values (uptime, cache_entries, a
// "circuit_breaker" that did not exist). It now reports only things it can
// actually observe, and says which external tools the dispatch pipeline
// needs are missing — the most common cause of a dispatch that starts and
// then does nothing useful.
//
// Public by design: no session required, no secrets in the payload.

import { execFileSync } from "node:child_process";
import { childEnv } from "@/lib/child-env";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function hasBin(cmd: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(cmd, args, {
      stdio: "pipe",
      timeout: 3000,
      windowsHide: true,
      env: childEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

function countDispatchLogs(): number {
  try {
    return readdirSync(join(process.cwd(), ".dispatches")).filter((f) => f.endsWith(".log")).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  const mcpBuilt = existsSync(join(process.cwd(), "mcp-server", "dist", "server.js"));

  // Each of these is a hard requirement for some part of the pipeline;
  // a false here explains a class of downstream failure.
  const deps = {
    claude: hasBin("claude"),
    gh: hasBin(process.env.GH_CLI ?? "gh"),
    git: hasBin("git"),
    patch: hasBin("patch"),
    gitleaks: hasBin("gitleaks"), // optional — scan is skipped when absent
    mcp_server_built: mcpBuilt,
  };

  // Degraded rather than ok when something the agentic path needs is gone.
  const required: Array<keyof typeof deps> = ["claude", "gh", "git", "mcp_server_built"];
  const missing = required.filter((k) => !deps[k]);

  return Response.json({
    status: missing.length === 0 ? "ok" : "degraded",
    missing,
    deps,
    auth: process.env.AUTH_DISABLED === "1" ? "disabled" : "auth0",
    tests_mode: process.env.OPENSRCER_RUN_TESTS ?? "crucible",
    dispatch_logs: countDispatchLogs(),
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
