import Link from "next/link";
import { redirect } from "next/navigation";

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.length > 2048) return "/";
  return value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production") {
    redirect(returnTo === "/" || returnTo.startsWith("/login") ? "/discover" : returnTo);
  }
  const loginHref = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="mx-auto grid w-full max-w-[1000px] flex-1 gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_420px] lg:items-center lg:gap-20 lg:py-24">
      <section>
        <p className="text-sm font-medium text-signal">Connect your GitHub account</p>
        <h1 className="mt-5 max-w-lg text-[40px] font-semibold leading-tight tracking-[-0.04em] sm:text-[48px]">Pick up where the issue leaves off.</h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-paper-dim">Browse repositories, generate a patch, and review the change before opening a draft pull request.</p>
        <Link href="/demo" className="mt-8 inline-flex text-sm text-paper-dim hover:text-paper">Explore the demo without signing in <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6 sm:p-8" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading" className="text-xl font-medium tracking-tight">Sign in to opensrcer</h2>
        <p className="mt-2 text-sm leading-6 text-paper-muted">Authentication is handled by Auth0 using your GitHub account.</p>
        <a href={loginHref} className="mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink transition hover:bg-signal-soft">
          <GitHubMark />
          Continue with GitHub
        </a>

        <div className="mt-8 border-t border-border pt-6">
          <h3 className="text-sm font-medium">Access requested</h3>
          <ul className="mt-3 space-y-3 text-sm leading-6 text-paper-dim">
            <li><strong className="font-medium text-paper">Public repositories</strong> to fork repositories and open draft pull requests.</li>
            <li><strong className="font-medium text-paper">Profile and email</strong> to identify your account and attribute commits.</li>
            <li><strong className="font-medium text-paper">Organization membership</strong> to verify administrator access when you connect an organization.</li>
          </ul>
        </div>
        <p className="mt-6 text-xs leading-5 text-paper-muted">Private repositories require a separate GitHub App connection that you initiate from Settings. You can revoke OAuth access from GitHub at any time.</p>
      </section>
    </div>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
