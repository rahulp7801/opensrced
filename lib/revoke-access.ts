// Stop an account's active work, disconnect its organizations and clear its
// provider keys. Shared by POST /api/auth/revoke-all ("Disconnect opensrcer")
// and DELETE /api/me ("Delete my data"), which does this first so no running
// worker can write new records after the account's data is erased. The
// GitHub App installation itself stays installed; other members of the
// organization may still depend on it.

import { listOrgsFor, deleteMappingsForUser } from "./crucible/orgs";
import { clearStoredKeys } from "./api-keys";
import { clearInstallationToken } from "./crucible/github-app";
import { cloudExecution, runIsActive } from "./cloud-run-state";
import { cancelCloudRun, listCloudRunSummaries } from "./cloud-runs";
import { cancelDispatch, listDispatches } from "./dispatcher";

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

/** Throws when cancellation can't be recorded; connections are then left intact. */
export async function revokeAccess(owner: string): Promise<{ stopped: number; disconnected: number }> {
  // A run captures its short-lived credentials when it starts. Record a
  // durable cancellation before clearing connections so a worker cannot
  // publish after the user has revoked access.
  const stopped = await stopActiveRuns(owner);

  const orgs = await listOrgsFor(owner);
  await deleteMappingsForUser(owner);
  for (const org of orgs) clearInstallationToken(org.installation_id);

  await clearStoredKeys();
  return { stopped, disconnected: orgs.length };
}

/** Sign-out URL that lands on the app's origin. APP_BASE_URL is the v4 name;
 *  AUTH0_BASE_URL is the v3 spelling, kept as a fallback to match lib/auth0.ts.
 *  The bare origin is the documented Allowed Logout URL; an unlisted returnTo
 *  makes Auth0 refuse the logout and keep its session alive. */
export function logoutUrl(): string {
  const baseUrl = process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || "http://localhost:3000";
  return `/auth/logout?returnTo=${encodeURIComponent(baseUrl)}`;
}
