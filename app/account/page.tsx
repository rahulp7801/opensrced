/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are user-controlled. */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiKeysForm } from "@/app/crucible/api-keys-form";
import { DeleteAccount } from "@/components/delete-account";
import { PageHeading } from "@/components/page-heading";
import { SettingsSection } from "@/components/settings-section";
import { GITHUB_SCOPES } from "@/lib/auth0";
import { safeAvatarUrl } from "@/lib/avatar-url";
import { MemberSince } from "@/components/member-since";
import { RecordSummary } from "@/components/record-summary";
import { ProjectMaps } from "@/components/project-map";
import { flagEnabled } from "@/lib/flags";
import { authDisabled, sessionAccount } from "@/lib/require-session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

/** Why each scope in lib/auth0.ts GITHUB_SCOPES is asked for. */
const SCOPE_REASONS: Record<(typeof GITHUB_SCOPES)[number], string> = {
  public_repo: "Fork public repositories and open draft pull requests in your name.",
  "read:user": "Read your public profile: login, name and avatar.",
  "user:email": "Read your email addresses, to attribute commits to you.",
  "read:org": "Check you administer an organization before connecting it.",
};

export default async function AccountPage() {
  const account = await sessionAccount();
  if (!account) redirect(`/login?returnTo=${encodeURIComponent("/account")}`);
  const localMode = authDisabled();
  const picture = safeAvatarUrl(account.picture);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8">
      <PageHeading
        path="account"
        title={<>Account</>}
        description="Your profile, the AI you've connected, what opensrcer may do on GitHub, and your data."
        actions={<Link href="/crucible" className="text-link text-[15px]">Organizations and run budget are in Settings</Link>}
      />

      <div className="divide-y divide-border border-t-2 border-paper">
        <SettingsSection id="profile-heading" title="Profile" description="Who you're signed in as.">
          <div className="card flex flex-wrap items-center gap-4 px-5 py-4">
            {picture ? (
              <img src={picture} alt="" width={56} height={56} className="rounded-full" />
            ) : (
              <span aria-hidden className="grid size-14 place-items-center rounded-full border border-border-strong bg-surface-2 text-[22px] font-medium text-paper">
                {account.login.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-semibold text-paper">{localMode ? "Local workspace" : `@${account.login}`}</p>
              {account.name && !localMode && <p className="truncate text-[14px] text-paper-muted">{account.name}</p>}
              <p className="mt-1 text-[13px] text-paper-muted"><MemberSince /></p>
            </div>
            <Link href="/welcome?returnTo=%2Faccount" className="btn-quiet" data-size="sm">Redo setup</Link>
          </div>
        </SettingsSection>

        <SettingsSection
          id="ai-heading"
          title="Connected AI"
          description="The AI runs use, in order. The same settings as in Settings."
          note="Keys are encrypted in account-bound, HTTP-only cookies and sent only to the selected provider."
        >
          <ApiKeysForm />
        </SettingsSection>

        <SettingsSection id="github-heading" title="GitHub permissions" description="What signing in with GitHub lets opensrcer do.">
          {localMode ? (
            <p className="card p-5 text-[14px] leading-6 text-paper-dim">Local mode has no GitHub sign-in. It uses the <code className="font-mono text-[12.5px]">GITHUB_TOKEN</code> in <code className="font-mono text-[12.5px]">.env.local</code>, if you set one.</p>
          ) : (
            <>
              <ul className="card divide-y divide-border-soft overflow-hidden">
                {GITHUB_SCOPES.map((scope) => (
                  <li key={scope} className="px-4 py-3">
                    <code className="font-mono text-[13px] text-paper">{scope}</code>
                    <p className="mt-0.5 text-[14px] leading-[1.5] text-paper-muted">{SCOPE_REASONS[scope]}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[14px] leading-6 text-paper-dim">
                To revoke this access, remove opensrcer in{" "}
                <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" className="text-link">GitHub&apos;s authorized OAuth apps</a>.
                That stops opensrcer acting on GitHub for you from every device.
              </p>
            </>
          )}
        </SettingsSection>

        {!localMode && (
          <SettingsSection id="sessions-heading" title="Sessions" description="Where you're signed in.">
            <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <p className="text-[14px] text-paper-dim">This browser</p>
              <a href="/auth/logout" className="btn-quiet" data-size="sm">Sign out</a>
            </div>
            <p className="mt-4 max-w-[62ch] text-[13.5px] leading-[1.55] text-paper-muted">
              There&apos;s no &ldquo;sign out everywhere&rdquo;: each browser holds its own encrypted session cookie and opensrcer keeps
              no list of sessions it could end. A session ends after a day without use, and after three days at most. To stop
              access from every device right away, revoke opensrcer on GitHub (above).
            </p>
          </SettingsSection>
        )}

        {flagEnabled("record") && (
          <SettingsSection id="record-heading" title="Your record" description="Your level and standing, from your merged PRs, and the code you know. Private to you.">
            <RecordSummary />
            <ProjectMaps />
          </SettingsSection>
        )}

        <SettingsSection id="data-heading" title="Your data" description="Download or erase what opensrcer keeps about you.">
          <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <h3 className="text-[15px] font-semibold text-paper">Export my data</h3>
              <p className="mt-1 text-[14px] leading-[1.5] text-paper-muted">A JSON file with your account record, lessons, contributions, run records and stats.</p>
            </div>
            <a href="/api/me/export" download className="btn-quiet" data-size="sm">Download JSON</a>
          </div>
          <div className="mt-5">
            <DeleteAccount login={account.login} />
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
