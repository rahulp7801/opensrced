import Link from "next/link";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth-config";
import { safeReturnTo } from "@/lib/safe-return-to";
import { inviteOnly } from "@/lib/access";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production") {
    redirect(returnTo === "/" || returnTo.startsWith("/login") ? "/discover" : returnTo);
  }
  // connection=github skips Auth0's own provider screen (middleware allows exactly this value).
  const loginHref = `/auth/login?connection=github&returnTo=${encodeURIComponent(returnTo)}`;
  const canSignIn = authConfigured();
  // Private preview: sign-in is for invited accounts; the product tour stays public.
  const preview = inviteOnly();

  return (
    <div className="mx-auto grid w-full max-w-[1000px] flex-1 gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_420px] lg:items-center lg:gap-20 lg:py-24">
      <section>
        {preview ? (
          <>
            <p className="label-mono">Private preview</p>
            <h1 className="display mt-5 max-w-lg text-[48px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[68px]">Sign in with your invite.</h1>
            <p className="mt-6 max-w-lg text-[17px] leading-[1.6] text-paper-dim">opensrcer is open to invited GitHub accounts while it&apos;s in preview. It opens to everyone soon.</p>
            <Link href="/demo" className="link mt-6 inline-flex min-h-11 items-center text-[16px]">Not invited yet? Watch a complete run in the product tour <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
          </>
        ) : (
          <>
            <p className="label-mono">Connect your GitHub account</p>
            <h1 className="display mt-5 max-w-lg text-[48px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[68px]">Pick up where the issue leaves off.</h1>
            <p className="mt-6 max-w-lg text-[17px] leading-[1.6] text-paper-dim">Browse repositories, generate a patch, and review the change before opening a draft pull request.</p>
            <Link href="/demo" className="link mt-8 inline-flex min-h-11 items-center text-[16px]">Explore the demo without signing in <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
          </>
        )}
      </section>

      <section className="card p-6 sm:p-8" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading" className="display text-[28px] leading-[1.05] text-paper">{canSignIn ? "Sign in to opensrcer" : "Sign-in is being configured"}</h2>
        <p className="mt-3 text-[16px] leading-[1.6] text-paper-muted">{canSignIn ? "Authentication is handled by Auth0 using your GitHub account." : "This deployment is available for preview, but its GitHub sign-in is not ready yet."}</p>
        {canSignIn && params.error === "signin" && (
          <p role="alert" className="callout callout-alert mt-4 text-[15px] leading-6">
            Sign-in didn&apos;t complete. The sign-in page may have been open too long, or cookies may be blocked. Please try again.
          </p>
        )}
        {canSignIn ? (
          <a href={loginHref} className="btn-primary mt-6 flex min-h-12 w-full gap-3 text-[16px]">
            <GitHubMark />
            Continue with GitHub
          </a>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            {!preview && <Link href="/demo" className="btn-primary min-h-12 px-6">Explore the demo</Link>}
            <a href="/api/health" className="text-link">Service status</a>
          </div>
        )}

        {canSignIn && <div className="mt-8 border-t border-border-soft pt-6">
          <h3 className="label-mono">Access requested</h3>
          <ul className="mt-3 space-y-3 text-[15px] leading-[1.6] text-paper-dim">
            <li><strong className="font-medium text-paper">Public repositories</strong> to fork repositories and open draft pull requests.</li>
            <li><strong className="font-medium text-paper">Profile and email</strong> to identify your account and attribute commits.</li>
            <li><strong className="font-medium text-paper">Organization membership</strong> to verify administrator access when you connect an organization.</li>
          </ul>
        </div>}
        {canSignIn && <p className="mt-6 text-[13px] leading-[1.55] text-paper-muted">
Private repositories require a separate GitHub App connection that you initiate from Settings. You can revoke OAuth access from GitHub at any time.</p>}
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
