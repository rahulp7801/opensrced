// Phase 2: after login, show verified GitHub orgs for this Auth0 user
// and a "Connect GitHub Org" CTA. Replaces the Phase 1 placeholder.
// Per-org repo drill-down + findings list land in Phase 4.

import Link from "next/link";
import { getSession } from "@auth0/nextjs-auth0";
import { PageHeading } from "@/components/page-heading";
import { listOrgsFor } from "@/lib/crucible/orgs";
import { DisconnectButton } from "./disconnect-button";
import { RevokeAllButton } from "./revoke-all-button";
import { ApiKeysForm } from "./api-keys-form";

export const dynamic = "force-dynamic";

const CONNECT_ERRORS: Record<string, string> = {
  missing_installation_id: "GitHub didn't return an installation_id.",
  missing_state_cookie: "Install state cookie was missing — start the connect flow from this page.",
  bad_state_cookie: "Install state cookie was malformed.",
  state_mismatch: "Install state didn't match — possible CSRF attempt, please retry.",
  not_an_org_install: "That installation was on a personal account. Crucible needs an Organization install.",
};

export default async function CruciblePage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const session = await getSession();
  const user = session?.user;
  const params = await searchParams;
  const connectErrorKey = params?.connect_error;
  const connectError = connectErrorKey
    ? CONNECT_ERRORS[connectErrorKey] || `Connect failed: ${connectErrorKey}`
    : null;

  const orgs = user?.sub ? listOrgsFor(user.sub) : [];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>Crucible</>}
        description={
          <>
            Connect a GitHub Organization to scan its private repos for real
            bugs, security advisories, and Dependabot alerts — then land
            verified draft PRs whose patches have already passed the repo&apos;s
            own tests.
          </>
        }
      />

      <div className="mt-6 flex items-center justify-between gap-3 text-[12px] text-paper-muted">
        <div>
          signed in as{" "}
          <span className="text-paper">{user?.name || user?.email || "(unknown)"}</span>
        </div>
        <Link
          href="/api/crucible/connect"
          className="border border-border bg-surface/60 px-3 py-1.5 text-[12px] text-paper hover:bg-surface"
        >
          Connect GitHub Org
        </Link>
      </div>

      {connectError && (
        <div className="mt-4 border border-amber-700/60 bg-amber-950/30 p-3 text-[12.5px] text-amber-200">
          {connectError}
        </div>
      )}

      <section className="mt-6">
        <div className="mono-label text-paper-muted">verified orgs</div>
        {orgs.length === 0 ? (
          <div className="mt-2 border border-border bg-surface/40 p-6 text-[12.5px] text-paper-dim leading-relaxed">
            No orgs connected yet. Click <span className="text-paper">Connect GitHub Org</span>{" "}
            to install the <code>opensrcer-crucible</code> GitHub App on an
            organization you administer. After install, GitHub will redirect
            you back here and the org will appear below.
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
                    className="text-[12px] text-paper-dim hover:text-paper"
                  >
                    open →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mono-label text-paper-muted">api keys</div>
        <div className="mt-2 border border-border bg-surface/40 p-4">
          <ApiKeysForm />
        </div>
      </section>

      <section className="mt-12 pt-6 border-t border-border-soft">
        <div className="mono-label text-paper-muted">danger zone</div>
        <div className="mt-2 text-[12px] text-paper-dim leading-relaxed max-w-xl">
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
      </section>
    </div>
  );
}
