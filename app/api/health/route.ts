// GET /api/health — liveness + a truthful readiness picture.
//
// This used to return seeded fake values (uptime, cache_entries, a
// "circuit_breaker" that did not exist). It now reports only things it can
// actually observe, and says which external tools the dispatch pipeline
// needs are missing — the most common cause of a dispatch that starts and
// then does nothing useful.
//
// Public by design: no session required, no secrets in the payload.

import { getDependencies } from "@/lib/health";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

async function countDispatchLogs(): Promise<number> {
  try {
    return (await readdir(join(process.cwd(), ".dispatches"))).filter((f) => f.endsWith(".log")).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  const [deps, dispatchLogs] = await Promise.all([getDependencies(), countDispatchLogs()]);

  // Degraded rather than ok when something the agentic path needs is gone.
  const required: Array<keyof typeof deps> = ["claude", "gh", "git", "mcp_server_built"];
  const missing = required.filter((k) => !deps[k]);

  return Response.json({
    status: missing.length === 0 ? "ok" : "degraded",
    missing,
    deps,
    auth: process.env.AUTH_DISABLED === "1" ? "disabled" : "auth0",
    tests_mode: process.env.OPENSRCER_RUN_TESTS ?? "crucible",
    dispatch_logs: dispatchLogs,
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
