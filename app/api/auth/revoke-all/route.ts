// POST /api/auth/revoke-all
// Stop this user's active work, disconnect their organizations, and clear
// their provider keys. The GitHub App installation itself remains installed;
// other members of the organization may still depend on it.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { listOrgsFor, deleteMappingsForUser } from "@/lib/crucible/orgs";
import { clearStoredKeys } from "@/lib/api-keys";
import { clearInstallationToken } from "@/lib/crucible/github-app";
import { cloudExecution, runIsActive } from "@/lib/cloud-run-state";
import { cancelCloudRun, listCloudRunSummaries } from "@/lib/cloud-runs";
import { cancelDispatch, listDispatches } from "@/lib/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function stopActiveRuns(owner: string): Promise<number> {
  if (cloudExecution()) {
    const active = (await listCloudRunSummaries(owner, 50)).filter(runIsActive);
    const stopped = await Promise.all(active.map((run) => cancelCloudRun(owner, run.id)));
    return stopped.filter(Boolean).length;
  }

  return listDispatches(owner, 50)
    .filter((run) => run.status === "running")
    .filter((run) => cancelDispatch(run.id, owner).ok)
    .length;
}

export async function POST() {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    // A run captures its short-lived credentials when it starts. Record a
    // durable cancellation before clearing connections so a worker cannot
    // publish after the user has revoked access.
    const stopped = await stopActiveRuns(sub);

    const orgs = await listOrgsFor(sub);
    await deleteMappingsForUser(sub);
    for (const org of orgs) clearInstallationToken(org.installation_id);

    await clearStoredKeys();

    // APP_BASE_URL is the v4 name; AUTH0_BASE_URL is the v3 spelling, kept
    // as a fallback to match lib/auth0.ts.
    const baseUrl =
      process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || "http://localhost:3000";
    const logoutUrl = `/auth/logout?returnTo=${encodeURIComponent(baseUrl + "/login")}`;
    return NextResponse.json({ ok: true, stopped, disconnected: orgs.length, redirect: logoutUrl });
  } catch {
    // Keep the session and connections intact when cancellation cannot be
    // recorded. The user can retry instead of receiving a false assurance.
    return NextResponse.json(
      { error: "Could not stop active work. Your connections remain available; please retry." },
      { status: 503 },
    );
  }
}
