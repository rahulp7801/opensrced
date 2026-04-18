import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-16 md:py-24">
      {/* Hero */}
      <section className="text-center">
        <div className="inline-flex items-center gap-2 border border-border bg-surface/40 px-3 py-1 text-[11px] text-paper-muted mb-8">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          AI-powered open-source contributions
        </div>
        <h1 className="serif text-[48px] md:text-[72px] leading-[0.95] tracking-tight text-paper">
          Find bugs.<br />
          Fix them.<br />
          <span className="text-signal">Prove it works.</span>
        </h1>
        <p className="mt-6 max-w-xl mx-auto text-[14px] leading-relaxed text-paper-dim">
          opensrcer scans repositories for real bugs and security advisories,
          generates verified patches using AI, and opens draft PRs — only
          after the repo&apos;s own test suite passes.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 border border-signal bg-signal/10 px-6 py-3 text-[14px] font-medium text-paper hover:bg-signal/20 transition"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Get started with GitHub
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-24">
        <div className="text-center mb-12">
          <h2 className="serif text-[28px] text-paper tracking-tight">How it works</h2>
          <p className="mt-2 text-[13px] text-paper-dim">Three steps to verified patches.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-border">
          <Step
            number="01"
            title="Scan"
            description="Connect your GitHub account. opensrcer discovers open issues, security advisories, and Dependabot alerts across your repositories."
          />
          <Step
            number="02"
            title="Fix"
            description="AI explores the codebase, diagnoses the root cause, and generates a minimal patch. You control the budget — set a spend cap per task."
            border
          />
          <Step
            number="03"
            title="Verify"
            description="Before opening a PR, the patch runs against the repo's own test suite. Only verified patches get pushed. Failed tests block the PR and show you why."
            border
          />
        </div>
      </section>

      {/* Crucible */}
      <section className="mt-24">
        <div className="border border-border">
          <div className="p-8 md:p-10">
            <div className="flex items-center gap-3 mb-4">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 1.5L2.5 4v4c0 3.5 2.3 6.1 5.5 7 3.2-.9 5.5-3.5 5.5-7V4L8 1.5z" />
                <path d="M6 8l1.5 1.5L10 6.5" />
              </svg>
              <span className="mono-label text-signal">Crucible</span>
            </div>
            <h2 className="serif text-[32px] text-paper tracking-tight leading-tight">
              Private repos.<br />
              Verified patches.
            </h2>
            <p className="mt-4 max-w-lg text-[13px] text-paper-dim leading-relaxed">
              Connect your GitHub Organization through a dedicated GitHub App.
              opensrcer scans your private repos for vulnerabilities and open
              issues, then lands draft PRs whose patches have been verified
              against the repo&apos;s own test suite — all using short-lived
              installation tokens. No long-lived credentials, no ambient access.
            </p>
          </div>
          <div className="border-t border-border grid grid-cols-1 sm:grid-cols-3">
            <Feature title="GitHub App auth" detail="Short-lived tokens, per-org scope, revocable anytime" />
            <Feature title="Test-gated PRs" detail="Patches only land if the repo's tests pass" border />
            <Feature title="Zero storage" detail="API keys encrypted in cookies, never on our servers" border />
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="mt-24">
        <div className="text-center mb-8">
          <h2 className="serif text-[28px] text-paper tracking-tight">Security first</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-border">
          <SecurityItem
            title="No stored credentials"
            detail="GitHub tokens and API keys live in encrypted browser cookies (AES-256-GCM). The server decrypts in memory only to make API calls, then discards. Nothing is written to disk or a database."
          />
          <SecurityItem
            title="Auth0 identity"
            detail="Your password is never shared with opensrcer. Authentication is brokered through Auth0 — we only receive your profile and a scoped GitHub token."
            border
          />
          <SecurityItem
            title="Spend controls"
            detail="Set a hard cap on AI spend per task ($0.50–$10). The model stops cleanly when the limit is reached. No surprise bills."
            borderTop
          />
          <SecurityItem
            title="Full revocability"
            detail="Disconnect orgs, clear API keys, and sign out with one click. Revoke the GitHub OAuth app entirely from github.com/settings/applications."
            border
            borderTop
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mt-24 text-center pb-8">
        <h2 className="serif text-[28px] text-paper tracking-tight">Ready to start?</h2>
        <p className="mt-2 text-[13px] text-paper-dim">Sign in with GitHub. No credit card required.</p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 border border-signal bg-signal/10 px-6 py-3 text-[14px] font-medium text-paper hover:bg-signal/20 transition"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </Link>
        </div>
      </section>
    </div>
  );
}

function Step({
  number,
  title,
  description,
  border,
}: {
  number: string;
  title: string;
  description: string;
  border?: boolean;
}) {
  return (
    <div className={`p-6 ${border ? "md:border-l border-t md:border-t-0 border-border" : ""}`}>
      <div className="mono-label text-signal">{number}</div>
      <div className="mt-2 serif text-[20px] text-paper">{title}</div>
      <p className="mt-2 text-[12.5px] text-paper-dim leading-relaxed">{description}</p>
    </div>
  );
}

function Feature({
  title,
  detail,
  border,
}: {
  title: string;
  detail: string;
  border?: boolean;
}) {
  return (
    <div className={`p-5 ${border ? "sm:border-l border-t sm:border-t-0 border-border" : ""}`}>
      <div className="text-[13px] text-paper font-medium">{title}</div>
      <div className="mt-1 text-[11.5px] text-paper-dim">{detail}</div>
    </div>
  );
}

function SecurityItem({
  title,
  detail,
  border,
  borderTop,
}: {
  title: string;
  detail: string;
  border?: boolean;
  borderTop?: boolean;
}) {
  return (
    <div
      className={[
        "p-6",
        border ? "sm:border-l border-border" : "",
        borderTop ? "border-t border-border" : "",
      ].join(" ")}
    >
      <div className="text-[13px] text-paper font-medium">{title}</div>
      <p className="mt-2 text-[12px] text-paper-dim leading-relaxed">{detail}</p>
    </div>
  );
}
