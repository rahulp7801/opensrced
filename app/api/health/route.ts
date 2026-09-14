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
import { authConfigured } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

async function countDispatchLogs(): Promise<number> {
  try {
    return (await readdir(join(process.cwd(), ".dispatches"))).filter((f) => f.endsWith(".log")).length;
  } catch {
    return 0;
  }
}

export async function GET(request: Request) {
  if (cloudExecution()) {
    const deps = {
      auth0_config: authConfigured(),
      worker_snapshot: Boolean(process.env.OPENSRCER_WORKER_SNAPSHOT_ID),
      private_storage: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      // Vercel exposes OIDC through the request context at runtime. Keep the
      // environment fallback for builds and local `vercel env pull` sessions.
      sandbox_identity: Boolean(
        request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN,
      ),
    };
    const missing = Object.entries(deps).filter(([, ready]) => !ready).map(([name]) => name);
    return Response.json({ status: missing.length ? "degraded" : "ok", execution: "vercel-sandbox", deps, missing,
      auth: "auth0", tests_mode: "off", uptime_sec: Math.round(process.uptime()), timestamp: new Date().toISOString() });
  }
  const [deps, dispatchLogs] = await Promise.all([getDependencies(), countDispatchLogs()]);

  // Degraded rather than ok when something the agentic path needs is gone.
  const required: Array<keyof typeof deps> = ["claude", "gh", "git", "gitleaks", "graph_runtime", "mcp_server_built"];
  const missing: string[] = required.filter((k) => !deps[k]);
  const auth0Config = authConfigured();
  if (process.env.AUTH_DISABLED !== "1" && !auth0Config) missing.push("auth0_config");

  return Response.json({
    status: missing.length === 0 ? "ok" : "degraded",
    missing,
    deps: { ...deps, auth0_config: auth0Config },
    auth: process.env.AUTH_DISABLED === "1" ? "disabled" : "auth0",
    tests_mode: process.env.OPENSRCER_RUN_TESTS ?? "crucible",
    dispatch_logs: dispatchLogs,
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
