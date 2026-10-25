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
  not_an_org_install: "That installation was on a personal account. Organization access requires a GitHub Organization install.",
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

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string }>;
}) {
  const localMode = authDisabled();
  const session = localMode ? null : await auth0.getSession();
  const user = session?.user;
  const params = await searchParams;
  const connectError = params.connect_error
    ? connectErrorMessage(params.connect_error)
    : null;
  const orgs = user?.sub ? await listOrgsFor(user.sub) : [];
  // The connect route answers 503 without a GitHub App, so only offer it when one is set up.
  const canConnectOrgs = !localMode && Boolean(process.env.GITHUB_APP_SLUG);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8">
      <PageHeading
        path="account / settings"
        title={<>Settings</>}
        description="Manage provider credentials, GitHub access, and your account."
      />

      <div className="divide-y divide-border border-t-2 border-paper">
        <SettingsSection
          id="provider-heading"
          title="How runs are paid for"
          description="Use your own Claude subscription first, with an API key as an optional fallback. Gemini keys power patch review."
          note="Keys are encrypted in account-bound, HTTP-only cookies and sent only to the selected provider. opensrcer never asks for, sees, or stores your Claude or ChatGPT login."
        >
          <ApiKeysForm />
        </SettingsSection>

        <SettingsSection
          id="github-heading"
          title="GitHub access"
          description={localMode
            ? "Local development can inspect public repositories without a hosted account."
            : canConnectOrgs
              ? "Connect an organization only when you need to scan its private repositories."
              : "Public repositories work with your GitHub sign-in. Organization connections are not available on this deployment."}
        >
          <div className="card flex flex-wrap items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-[12.5px] font-medium text-paper-muted">Signed in as</p>
              <p className="mt-1 text-[14px] font-medium text-paper">
                {localMode ? "Local workspace" : user?.name || user?.email || "GitHub account"}
              </p>
            </div>
            {canConnectOrgs && (
              <a
                href="/api/crucible/connect"
                className="btn-quiet" data-size="sm"
              >
                Connect organization
              </a>
            )}
          </div>

          {connectError && (
            <div className="callout callout-alert mt-4 p-4 text-[14px] leading-6" role="alert">
              {connectError}
            </div>
          )}

          {localMode ? (
            <div className="card mt-5 p-5">
              <h3 className="text-[14px] font-medium text-paper">Opening pull requests locally</h3>
              <p className="mt-2 text-[14px] leading-6 text-paper-dim">
                Add <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-signal">GITHUB_TOKEN</code> to <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-paper">.env.local</code>, then restart the development server.
              </p>
              <p className="mt-2 text-[12.5px] leading-5 text-paper-muted">Private organization connections require hosted sign-in.</p>
            </div>
          ) : (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-medium text-paper">Connected organizations</h3>
                <span className="font-mono text-[12.5px] text-paper-muted">{orgs.length}</span>
              </div>
              {orgs.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-border-strong px-5 py-5 text-[14px] leading-6 text-paper-muted">
                  No organizations connected. Public repository workflows are already available.
                </p>
              ) : (
                <ul className="card mt-3 divide-y divide-border-soft overflow-hidden">
                  {orgs.map((org) => (
                    <li key={org.installation_id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-paper">{org.github_org}</p>
                        <p className="mt-0.5 text-[12.5px] text-paper-muted">
                          Verified {new Date(org.verified_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <DisconnectButton org={org.github_org} />
                        <Link
                          href={`/crucible/orgs/${org.github_org}`}
                          className="inline-flex min-h-9 items-center text-[14px] font-medium text-paper-dim hover:text-paper"
                        >
                          Open <span aria-hidden="true" className="ml-1">&rarr;</span>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SettingsSection>

        {!localMode && (
          <SettingsSection
            id="account-heading"
            title="Account"
            description="Remove opensrcer’s saved organization connections and end this session."
          >
            <div className="callout callout-alert p-5 sm:p-6">
              <h3 className="text-[16px] font-semibold text-paper">Disconnect opensrcer</h3>
              <p className="mt-2 max-w-2xl text-[14px] leading-6 text-paper-dim">
                This removes saved organization connections, revokes cached installation tokens, and signs you out. To remove the GitHub OAuth grant too, revoke it in{" "}
                <a
                  href="https://github.com/settings/applications"
                  target="_blank"
                  rel="noreferrer"
                  className="text-paper underline decoration-border-strong underline-offset-4 hover:text-signal"
                >
                  GitHub application settings
                </a>.
              </p>
              <div className="mt-4">
                <RevokeAllButton />
              </div>
            </div>
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

function SettingsSection({
  id,
  title,
  description,
  note,
  children,
}: {
  id: string;
  title: string;
  description: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-7 py-10 md:grid-cols-[260px_minmax(0,1fr)] md:gap-14" aria-labelledby={id}>

      <div>
        <h2 id={id} className="display text-[24px] leading-[1.05] text-paper">{title}</h2>
        <p className="mt-3 text-[16px] leading-[1.6] text-paper-muted">{description}</p>
        {note && <p className="mt-4 text-[14px] leading-[1.55] text-paper-muted">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
