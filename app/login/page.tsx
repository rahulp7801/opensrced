// Pre-login page. Explains the full auth flow: what Auth0 is, what GitHub
// OAuth does, what permissions are requested and why, and the privacy
// commitment — all BEFORE the user clicks anything.

import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params?.returnTo || "/";
  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" className="mx-auto" aria-hidden>
            <circle cx="16" cy="16" r="9" stroke="currentColor" className="text-paper-muted" />
            <circle cx="16" cy="16" r="1.6" fill="currentColor" className="text-signal" />
          </svg>
          <h1 className="mt-4 serif text-[28px] text-paper tracking-tight">
            opensrcer
          </h1>
          <p className="mt-2 text-[13px] text-paper-dim leading-relaxed max-w-sm mx-auto">
            AI-powered bug fixing for open-source and private repos.
          </p>
        </div>

        <div className="mt-8 border border-border bg-surface/40">
          {/* How it works */}
          <div className="p-6 border-b border-border-soft">
            <div className="mono-label text-paper-muted">how sign-in works</div>
            <div className="mt-3 space-y-3 text-[12.5px] text-paper-dim leading-relaxed">
              <div className="flex gap-3">
                <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 border border-border-soft text-[10px] text-paper-muted">1</span>
                <span>
                  You click <span className="text-paper">Sign in with GitHub</span> below.
                  This takes you to <span className="text-paper">Auth0</span>, a trusted
                  third-party authentication service — opensrcer never sees or
                  handles your password.
                </span>
              </div>
              <div className="flex gap-3">
                <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 border border-border-soft text-[10px] text-paper-muted">2</span>
                <span>
                  Auth0 redirects you to <span className="text-paper">GitHub</span> to
                  approve the permissions listed below. GitHub shows you exactly
                  what&apos;s being requested — you can review before approving.
                </span>
              </div>
              <div className="flex gap-3">
                <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 border border-border-soft text-[10px] text-paper-muted">3</span>
                <span>
                  After you approve, GitHub sends a short-lived token back
                  through Auth0 to opensrcer. This token is stored only in your
                  encrypted browser cookie — never on our servers.
                </span>
              </div>
            </div>
          </div>

          {/* What we request */}
          <div className="p-6 border-b border-border-soft">
            <div className="mono-label text-paper-muted">permissions requested from GitHub</div>
            <div className="mt-3 space-y-2.5 text-[12.5px] text-paper-dim leading-relaxed">
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">+</span>
                <span>
                  <span className="text-paper">Public repo access</span> — fork repos and
                  open draft PRs with AI-generated patches on your behalf
                </span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">+</span>
                <span>
                  <span className="text-paper">Read your profile</span> — display your name
                  and avatar in the dashboard
                </span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">+</span>
                <span>
                  <span className="text-paper">Read your email</span> — attribute commits to
                  you (shown as the commit author)
                </span>
              </div>
            </div>
          </div>

          {/* Security model */}
          <div className="p-6 border-b border-border-soft">
            <div className="mono-label text-paper-muted">security model</div>
            <div className="mt-3 space-y-2.5 text-[12.5px] text-paper-dim leading-relaxed">
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">~</span>
                <span>
                  Your GitHub token and API keys are <span className="text-paper">encrypted (AES-256-GCM)</span> and
                  stored in browser cookies — never in a database, never on disk
                </span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">~</span>
                <span>
                  When you trigger a task, the server decrypts your key
                  <span className="text-paper"> in memory only</span> to call
                  the AI provider, then discards it — keys are never logged or cached
                </span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-signal shrink-0 mt-0.5">~</span>
                <span>
                  Authentication is handled by <span className="text-paper">Auth0</span> — opensrcer
                  never sees your GitHub password
                </span>
              </div>
            </div>
          </div>

          {/* What we never do */}
          <div className="p-6 border-b border-border-soft">
            <div className="mono-label text-paper-muted">privacy commitment</div>
            <div className="mt-3 space-y-2.5 text-[12.5px] text-paper-dim leading-relaxed">
              <div className="flex gap-2.5">
                <span className="text-red-400 shrink-0 mt-0.5">-</span>
                <span>No database storage of tokens, keys, or personal information</span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-red-400 shrink-0 mt-0.5">-</span>
                <span>No access to private repos unless you explicitly connect an org</span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-red-400 shrink-0 mt-0.5">-</span>
                <span>No selling, sharing, or transmitting your data to third parties</span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-red-400 shrink-0 mt-0.5">-</span>
                <span>No analytics, no tracking — the only cookies are your encrypted session and keys</span>
              </div>
              <div className="flex gap-2.5">
                <span className="text-red-400 shrink-0 mt-0.5">-</span>
                <span>Everything is cleared the moment you sign out</span>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="p-6">
            <Link
              href={loginHref}
              className="flex items-center justify-center gap-3 w-full border border-border bg-surface-2/80 hover:bg-surface-2 px-4 py-3.5 text-[14px] font-medium text-paper transition"
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </Link>
            <div className="mt-4 text-center text-[11px] text-paper-faint leading-relaxed">
              Authentication is handled by{" "}
              <a href="https://auth0.com" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">Auth0</a>.
              Your password is never shared with opensrcer.
              You can revoke access at any time from the dashboard or from{" "}
              <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">
                GitHub settings
              </a>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
