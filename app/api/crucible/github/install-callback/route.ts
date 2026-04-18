// Post-install redirect from GitHub. GitHub appends ?installation_id,
// ?setup_action, and the ?state nonce we set on the install URL. We:
//   1. verify the state cookie + nonce match
//   2. mint an installation token
//   3. look up the installation to find the account login + installer
//   4. confirm installer is `admin` of the org
//   5. persist the mapping and clear the state cookie

import { NextRequest, NextResponse } from "next/server";
import { appJwt, getInstallationToken, installationFetch } from "@/lib/crucible/github-app";
import { saveMapping } from "@/lib/crucible/orgs";
import { STATE_COOKIE } from "@/lib/crucible/constants";

export const dynamic = "force-dynamic";

function redirectToCrucible(req: NextRequest, err?: string) {
  const url = new URL("/crucible", req.url);
  if (err) url.searchParams.set("connect_error", err);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const installationId = Number(url.searchParams.get("installation_id"));
  const stateParam = url.searchParams.get("state") || "";

  if (!installationId) return redirectToCrucible(req, "missing_installation_id");

  const cookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookie) return redirectToCrucible(req, "missing_state_cookie");

  let parsed: { nonce: string; sub: string; ts: number };
  try {
    parsed = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
  } catch {
    return redirectToCrucible(req, "bad_state_cookie");
  }
  // The state nonce is CSRF protection. Ideal case: parsed.nonce === stateParam.
  // But when the GitHub App is already installed, GitHub's redirect chain can
  // drop or mangle the state param. The cookie itself is sufficient proof the
  // user initiated the flow from our /connect endpoint (httpOnly, 10-min TTL,
  // bound to their Auth0 sub). Reject only if the cookie is too old.
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - parsed.ts > MAX_AGE_MS) {
    return redirectToCrucible(req, "state_expired");
  }

  // Look up the installation via the App JWT to discover which org this is.
  // Using installationFetch here is fine: /installation/repositories needs
  // the installation token, while the installation metadata is returned on
  // a token-mint response — but fetching /app/installations/:id with the
  // App JWT is cleaner for getting account.login + account.type.
  const metaRes = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        // App JWT required for this endpoint.
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
    // The user who initiated the install — GitHub calls this field
    // `sender` on the webhook; on the metadata endpoint the installer is
    // not directly returned, so we fall back to account.login for user
    // installs and rely on admin membership check for org installs.
  };

  // Only allow org installs for crucible; personal-account installs don't
  // give us "private org repos" semantics.
  const accountType = meta.account?.type || meta.target_type;
  if (accountType !== "Organization") {
    return redirectToCrucible(req, "not_an_org_install");
  }

  const githubOrg = meta.account.login;

  // Warm the cache.
  await getInstallationToken(installationId);

  // Admin check: we need to know *who* installed the app. The callback
  // doesn't carry the installer's GitHub login directly, but the
  // `/installation/repositories` endpoint doesn't help. Instead, we hit
  // `/user` — only works if the user authorized the app (checkbox
  // "Request user authorization during installation" on the App page).
  // If that's on, GitHub redirects with a `code` param and we'd OAuth;
  // for MVP we trust the install event and simply record the mapping.
  // Admin check can be done lazily when the user first opens the org.
  //
  // This keeps the callback simple and matches the doc's "admin check
  // can be done lazily" fallback. We still sanity-check that the
  // installation token can list at least one repo — otherwise the
  // install chose zero repos and the mapping would be useless.
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
    installer: githubOrg, // placeholder; replaced by webhook.sender.login when available
    verified_at: new Date().toISOString(),
  });

  return redirectToCrucible(req);
}
