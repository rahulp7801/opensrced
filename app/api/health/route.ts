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
import { cloudExecution } from "@/lib/cloud-run-state";

export const dynamic = "force-dynamic";

async function countDispatchLogs(): Promise<number> {
  try {
    return (await readdir(join(process.cwd(), ".dispatches"))).filter((f) => f.endsWith(".log")).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  if (cloudExecution()) {
    const deps = {
      worker_snapshot: Boolean(process.env.OPENSRCER_WORKER_SNAPSHOT_ID),
      private_storage: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      sandbox_identity: Boolean(process.env.VERCEL_OIDC_TOKEN),
    };
    const missing = Object.entries(deps).filter(([, ready]) => !ready).map(([name]) => name);
    return Response.json({ status: missing.length ? "degraded" : "ok", execution: "vercel-sandbox", deps, missing,
      auth: "auth0", tests_mode: "off", uptime_sec: Math.round(process.uptime()), timestamp: new Date().toISOString() });
  }
  const [deps, dispatchLogs] = await Promise.all([getDependencies(), countDispatchLogs()]);

  // Degraded rather than ok when something the agentic path needs is gone.
  const required: Array<keyof typeof deps> = ["claude", "gh", "git", "gitleaks", "graph_runtime", "mcp_server_built"];
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
