// Login page — clean CTA with collapsible security details.

import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params?.returnTo || "/";
  const loginHref = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
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
          {/* CTA — always visible at top */}
          <div className="p-6 border-b border-border-soft">
            <Link
              href={loginHref}
              className="flex items-center justify-center gap-3 w-full border border-border bg-surface-2/80 hover:bg-surface-2 px-4 py-3.5 text-[14px] font-medium text-paper transition"
            >
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </Link>
            <div className="mt-3 text-center text-[11px] text-paper-faint leading-relaxed">
              Secure authentication via Auth0. Your password is never shared with opensrcer.
            </div>
          </div>

          {/* Permissions — compact */}
          <div className="p-5 border-b border-border-soft">
            <div className="text-[11px] text-paper-muted font-medium mb-2">What we request from GitHub</div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="border border-signal/30 text-signal px-2 py-0.5">public repos</span>
              <span className="border border-signal/30 text-signal px-2 py-0.5">read profile</span>
              <span className="border border-signal/30 text-signal px-2 py-0.5">read email</span>
            </div>
            <p className="mt-2 text-[10.5px] text-paper-faint">
              Fork repos, open draft PRs, display your name, attribute commits to you.
            </p>
          </div>

          {/* Security details — collapsible */}
          <details className="group">
            <summary className="px-5 py-3 cursor-pointer text-[11px] text-paper-muted hover:text-paper-dim transition flex items-center gap-2">
              <span className="text-signal group-open:rotate-90 transition-transform inline-block">{">"}</span>
              How we protect your data
            </summary>
            <div className="px-5 pb-5 space-y-4 text-[11.5px] text-paper-dim leading-relaxed">
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-paper-muted mb-1.5">Security model</div>
                <div className="space-y-1.5">
                  <p>+ Tokens and API keys are <span className="text-paper">encrypted (AES-256-GCM)</span> in browser cookies — never in a database</p>
                  <p>+ Keys are decrypted <span className="text-paper">in memory only</span> for API calls, then discarded</p>
                  <p>+ Authentication handled by <span className="text-paper">Auth0</span> — we never see your GitHub password</p>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-paper-muted mb-1.5">Privacy commitment</div>
                <div className="space-y-1.5">
                  <p className="text-paper-faint">- No database storage of tokens, keys, or personal information</p>
                  <p className="text-paper-faint">- No access to private repos unless you explicitly connect an org</p>
                  <p className="text-paper-faint">- No analytics, no tracking — only session + key cookies</p>
                  <p className="text-paper-faint">- Everything is cleared the moment you sign out</p>
                </div>
              </div>
              <p className="text-[10px] text-paper-faint">
                Revoke access anytime from the dashboard or{" "}
                <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" className="underline hover:text-paper-muted">GitHub settings</a>.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
