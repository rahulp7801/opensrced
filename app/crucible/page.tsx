// Phase 2: after login, show verified GitHub orgs for this Auth0 user
// and a "Connect GitHub Org" CTA. Replaces the Phase 1 placeholder.
// Per-org repo drill-down + findings list land in Phase 4.

import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { PageHeading } from "@/components/page-heading";
import { listOrgsFor } from "@/lib/crucible/orgs";
import { DisconnectButton } from "./disconnect-button";
import { RevokeAllButton } from "./revoke-all-button";
import { ApiKeysForm } from "./api-keys-form";
import { authDisabled } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const CONNECT_ERRORS: Record<string, string> = {
  missing_installation_id: "GitHub didn't return an installation_id.",
  missing_state_cookie: "Install state cookie was missing — start the connect flow from this page.",
  bad_state_cookie: "Install state cookie was malformed.",
  state_mismatch: "Install state didn't match — possible CSRF attempt, please retry.",
  state_expired: "The GitHub connection window expired. Start the connection again.",
  session_mismatch: "Your sign-in changed during setup. Sign in again, then reconnect the organization.",
  not_an_org_install: "That installation was on a personal account. Crucible needs an Organization install.",
  no_github_identity: "GitHub access is missing from this session. Sign out and continue with GitHub again.",
  missing_read_org_scope: "GitHub did not grant organization access. Sign out, continue with GitHub again, and approve organization access.",
  not_a_member_of_org: "Your GitHub account is not an active member of that organization.",
  org_membership_not_active: "Your GitHub organization membership is not active.",
  not_an_org_admin: "Only a GitHub organization administrator can connect this installation.",
  install_lookup_unavailable: "GitHub did not respond while checking the installation. Please retry.",
  membership_lookup_unavailable: "GitHub did not respond while checking your organization role. Please retry.",
  repo_probe_unavailable: "GitHub did not respond while checking repository access. Please retry.",
  connection_storage_unavailable: "The verified connection could not be saved. Please retry.",
};

function connectErrorMessage(key: string): string {
  if (CONNECT_ERRORS[key]) return CONNECT_ERRORS[key];
  if (key.startsWith("install_lookup_failed_")) return "GitHub could not verify that installation. Check the installation and retry.";
  if (key.startsWith("membership_lookup_failed_")) return "GitHub could not verify your organization role. Check your access and retry.";
  if (key.startsWith("repo_probe_failed_")) return "The GitHub App cannot access a selected repository. Review its repository access and retry.";
  return "The GitHub organization connection failed. Please try again.";
}

export default async function CruciblePage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const localMode = authDisabled();
  const session = localMode ? null : await auth0.getSession();
  const user = session?.user;
  const params = await searchParams;
  const connectErrorKey = params?.connect_error;
  const connectError = connectErrorKey
    ? connectErrorMessage(connectErrorKey)
    : null;

  const orgs = user?.sub ? await listOrgsFor(user.sub) : [];

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 sm:px-8 py-10">
      <PageHeading
        title={<>Settings</>}
        description={
          <>
            Configure AI providers, set a run budget, and manage access to private repositories.
          </>
        }
      />

      <section className="mt-6 grid gap-6 border-t border-border pt-8 md:grid-cols-[240px_1fr] md:gap-10" aria-labelledby="provider-heading">
        <div><h2 id="provider-heading" className="text-lg font-medium">AI providers &amp; budget</h2><p className="mt-2 text-sm leading-6 text-paper-muted">Bring your own keys. Configure the providers needed for the features you use.</p><p className="mt-4 text-xs leading-5 text-paper-muted">Keys are encrypted in account-bound browser cookies and used server-side to contact your provider.</p></div>
        <ApiKeysForm />
      </section>

      <div className="mt-6 flex items-center justify-between gap-3 text-sm text-paper-muted">
        <div>
          Account:{" "}
          <span className="text-paper">{localMode ? "Local workspace" : user?.name || user?.email || "GitHub account"}</span>
        </div>
        {!localMode && (
          <Link
            href="/api/crucible/connect"
            className="border border-border bg-surface/60 px-3 py-1.5 text-sm text-paper hover:bg-surface"
          >
            Connect GitHub Org
          </Link>
        )}
      </div>

      {connectError && (
        <div className="mt-4 border border-amber-700/60 bg-amber-950/30 p-3 text-[12.5px] text-amber-200">
          {connectError}
        </div>
      )}

      {localMode ? (
        <section className="mt-6 rounded-lg border border-border bg-surface p-5 text-sm leading-6 text-paper-dim">
          Sign-in is disabled in local mode. Public repository workflows remain available; private organization connections require hosted sign-in.
        </section>
      ) : <section className="mt-6">
        <h2 className="text-lg font-medium">GitHub organizations</h2>
        {orgs.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-surface p-6 text-sm text-paper-dim leading-relaxed">
            No organizations connected. Connect an organization you administer to scan private repositories. Public repository workflows do not need this connection.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border-soft border border-border bg-surface/40">
            {orgs.map((o) => (
              <li key={o.installation_id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13.5px] text-paper">{o.github_org}</div>
                  <div className="text-[11px] text-paper-muted">
                    installation #{o.installation_id} · verified{" "}
                    {new Date(o.verified_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <DisconnectButton org={o.github_org} />
                  <Link
                    href={`/crucible/orgs/${o.github_org}`}
                    className="text-sm text-paper-dim hover:text-paper"
                  >
                    open →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {!localMode && <section className="mt-12 pt-6 border-t border-border-soft">
        <h2 className="text-lg font-medium">Disconnect account</h2>
        <div className="mt-2 text-sm text-paper-dim leading-relaxed max-w-xl">
          Permanently disconnect all organizations, revoke all cached tokens,
          and sign out. Your GitHub OAuth authorization will remain active
          until you revoke it at{" "}
          <a
            href="https://github.com/settings/applications"
            target="_blank"
            rel="noreferrer"
            className="text-paper hover:text-signal underline"
          >
            github.com/settings/applications
          </a>.
        </div>
        <div className="mt-3">
          <RevokeAllButton />
        </div>
      </section>}
    </div>
  );
}
