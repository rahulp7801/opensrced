// Org-admin verification for GitHub App connections. Kept free of the session
// module so it can be unit-tested; callers pass the user's own GitHub token.

import { deleteMappingsForUser, mappingForOrg } from "./orgs";

/** Is `login` an active admin of `org`, according to `org`'s own membership
 *  API, as seen by the caller's token? Returns the caller's login on success
 *  so we can record who actually connected. */
export async function verifyOrgAdmin(
  org: string,
  userToken: string,
): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  const headers = {
    Authorization: `Bearer ${userToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Who is the caller? `/user` also proves the token is live.
  const meRes = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
  if (!meRes.ok) return { ok: false, reason: `github_user_lookup_failed_${meRes.status}` };
  const me = (await meRes.json()) as { login?: string };
  if (!me.login) return { ok: false, reason: "github_user_has_no_login" };

  // Membership from the org's perspective. 403 means the token lacks
  // read:org; 404 means the caller simply isn't a member.
  const memRes = await fetch(
    `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
    { headers, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" },
  );
  if (memRes.status === 403) return { ok: false, reason: "missing_read_org_scope" };
  if (memRes.status === 404) return { ok: false, reason: "not_a_member_of_org" };
  if (!memRes.ok) return { ok: false, reason: `membership_lookup_failed_${memRes.status}` };

  const mem = (await memRes.json()) as { role?: string; state?: string };
  if (mem.state !== "active") return { ok: false, reason: "org_membership_not_active" };
  if (mem.role !== "admin") return { ok: false, reason: "not_an_org_admin" };

  return { ok: true, login: me.login };
}

// Admin status used to be checked only at connect time, so someone removed as
// an org admin kept private-repo access through their saved connection.
// ponytail: per-instance cache; a removed admin keeps access for up to 10 min.
const ADMIN_RECHECK_MS = 10 * 60_000;
const adminVerifiedUntil = new Map<string, number>();
// Definite answers that the caller no longer administers the org. Anything
// else (GitHub down, missing scope) denies this request without disconnecting.
const REVOKING = new Set(["not_a_member_of_org", "org_membership_not_active", "not_an_org_admin"]);

/** Re-confirm, before handing out an org's installation token for a user
 *  request, that the user still administers the org. */
export async function stillOrgAdmin(auth0UserId: string, org: string, userToken: string | null): Promise<boolean> {
  const key = `${auth0UserId}\n${org.toLowerCase()}`;
  if ((adminVerifiedUntil.get(key) ?? 0) > Date.now()) return true;
  let check: Awaited<ReturnType<typeof verifyOrgAdmin>> = { ok: false, reason: "no_github_identity" };
  if (userToken) {
    try { check = await verifyOrgAdmin(org, userToken); }
    catch { return false; }
  }
  if (check.ok) {
    adminVerifiedUntil.set(key, Date.now() + ADMIN_RECHECK_MS);
    return true;
  }
  if (REVOKING.has(check.reason)) {
    const mapping = await mappingForOrg(auth0UserId, org);
    if (mapping) await deleteMappingsForUser(auth0UserId, mapping.installation_id);
  }
  return false;
}
