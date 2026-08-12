// Post-install redirect from GitHub. GitHub appends ?installation_id,
// ?setup_action, and the ?state nonce we set on the install URL. We:
//   1. verify the state cookie AND that its nonce matches ?state
//   2. look up the installation to find the account login
//   3. confirm the CALLER is an admin of that org, using the caller's own
//      GitHub token — not the App JWT
//   4. mint an installation token and sanity-check it can see a repo
//   5. persist the mapping and clear the state cookie
//
// Steps 1 and 3 are load-bearing. `installation_id` is an attacker-supplied
// query parameter and installation ids are small sequential integers. Before
// this route checked them, any logged-in user could start the connect flow to
// mint a cookie for their own Auth0 sub, then hand back an arbitrary
// installation id and have saveMapping() bind THEIR account to SOMEONE ELSE'S
// org. Every crucible route authorizes purely off that mapping, so the payoff
// was full read/write on a stranger's private repos.
//
// The admin check needs the `read:org` scope, requested in lib/auth0.ts.
// Sessions created before that scope was added won't have it — those users
// have to log out and back in to connect an org.

import { NextRequest, NextResponse } from "next/server";
import { getInstallationToken, installationFetch } from "@/lib/crucible/github-app";
import { appJwt } from "@/lib/crucible/github-app";
import { saveMapping } from "@/lib/crucible/orgs";
import { STATE_COOKIE } from "@/lib/crucible/constants";
import { getGitHubTokenFromSession } from "@/lib/github-token";
import { auth0 } from "@/lib/auth0";

export const dynamic = "force-dynamic";

function redirectToCrucible(req: NextRequest, err?: string) {
  const url = new URL("/crucible", req.url);
  if (err) url.searchParams.set("connect_error", err);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

/** Constant-time-ish nonce comparison. Both values are hex of known length,
 *  so a length check plus a full-width XOR loop is enough. */
function nonceMatches(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Is `login` an active admin of `org`, according to `org`'s own membership
 *  API, as seen by the caller's token? Returns the caller's login on success
 *  so we can record who actually connected. */
async function verifyOrgAdmin(
  org: string,
  userToken: string,
): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  const headers = {
    Authorization: `Bearer ${userToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Who is the caller? `/user` also proves the token is live.
  const meRes = await fetch("https://api.github.com/user", { headers });
  if (!meRes.ok) return { ok: false, reason: `github_user_lookup_failed_${meRes.status}` };
  const me = (await meRes.json()) as { login?: string };
  if (!me.login) return { ok: false, reason: "github_user_has_no_login" };

  // Membership from the org's perspective. 403 means the token lacks
  // read:org; 404 means the caller simply isn't a member.
  const memRes = await fetch(
    `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
    { headers },
  );
  if (memRes.status === 403) return { ok: false, reason: "missing_read_org_scope" };
  if (memRes.status === 404) return { ok: false, reason: "not_a_member_of_org" };
  if (!memRes.ok) return { ok: false, reason: `membership_lookup_failed_${memRes.status}` };

  const mem = (await memRes.json()) as { role?: string; state?: string };
  if (mem.state !== "active") return { ok: false, reason: "org_membership_not_active" };
  if (mem.role !== "admin") return { ok: false, reason: "not_an_org_admin" };

  return { ok: true, login: me.login };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const installationId = Number(url.searchParams.get("installation_id"));
  const stateParam = url.searchParams.get("state") || "";

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return redirectToCrucible(req, "missing_installation_id");
  }

  const cookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookie) return redirectToCrucible(req, "missing_state_cookie");

  let parsed: { nonce: string; sub: string; ts: number };
  try {
    parsed = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
  } catch {
    return redirectToCrucible(req, "bad_state_cookie");
  }
  if (typeof parsed?.nonce !== "string" || typeof parsed?.sub !== "string") {
    return redirectToCrucible(req, "bad_state_cookie");
  }

  // CSRF: the nonce we minted must come back on the query string. This used
  // to be waived "because GitHub's redirect chain can drop the state param
  // when the app is already installed" — but the cookie alone proves only
  // that the caller started A flow, not that they finished THIS one, and the
  // installation id is fully attacker-controlled. If GitHub drops the param,
  // the user re-runs Connect; a re-run is cheap, a silent org bind is not.
  if (!nonceMatches(parsed.nonce, stateParam)) {
    return redirectToCrucible(req, "state_mismatch");
  }

  const MAX_AGE_MS = 10 * 60 * 1000;
  if (!Number.isFinite(parsed.ts) || Date.now() - parsed.ts > MAX_AGE_MS) {
    return redirectToCrucible(req, "state_expired");
  }

  // The cookie's `sub` must still be the live session's `sub`. Without this
  // a stolen/replayed cookie could bind an org to an account the current
  // browser is no longer logged into.
  const session = await auth0.getSession();
  if (!session?.user?.sub || session.user.sub !== parsed.sub) {
    return redirectToCrucible(req, "session_mismatch");
  }

  // Installation metadata — which org is this? App JWT is the right
  // credential for /app/installations/:id.
  const metaRes = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${appJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!metaRes.ok) {
    return redirectToCrucible(req, `install_lookup_failed_${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as {
    account: { login: string; type: string };
    target_type: string;
  };

  // Only org installs for crucible; personal-account installs don't give us
  // "private org repos" semantics.
  const accountType = meta.account?.type || meta.target_type;
  if (accountType !== "Organization") {
    return redirectToCrucible(req, "not_an_org_install");
  }

  const githubOrg = meta.account.login;

  // Authorization: prove the caller administers this org with the CALLER'S
  // credential. The App JWT can see every installation, so it can never be
  // the basis for this decision.
  const userToken = await getGitHubTokenFromSession();
  if (!userToken) {
    return redirectToCrucible(req, "no_github_identity");
  }
  const admin = await verifyOrgAdmin(githubOrg, userToken);
  if (!admin.ok) {
    return redirectToCrucible(req, admin.reason);
  }

  // Warm the token cache and confirm the install actually selected repos —
  // a zero-repo install would make the mapping useless.
  await getInstallationToken(installationId);
  const probe = await installationFetch(
    installationId,
    "https://api.github.com/installation/repositories?per_page=1"
  );
  if (!probe.ok) {
    return redirectToCrucible(req, `repo_probe_failed_${probe.status}`);
  }

  saveMapping({
    auth0_user_id: parsed.sub,
    github_org: githubOrg,
    installation_id: installationId,
    installer: admin.login,
    verified_at: new Date().toISOString(),
  });

  return redirectToCrucible(req);
}
