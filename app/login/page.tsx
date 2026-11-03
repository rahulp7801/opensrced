import Link from "next/link";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth-config";
import { safeReturnTo } from "@/lib/safe-return-to";
import { inviteOnly } from "@/lib/access";
import { AUTH_ERROR_COPY, parseAuthErrorKind } from "@/lib/auth-errors";
import { GitHubSignIn } from "@/components/github-sign-in";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production") {
    redirect(returnTo === "/" || returnTo.startsWith("/login") ? "/discover" : returnTo);
  }
  const canSignIn = authConfigured();
  // Private preview: sign-in is for invited accounts; the product tour stays public.
  const preview = inviteOnly();
  // Set by lib/auth0.ts onCallback when Auth0 or GitHub refused the sign-in.
  const failure = canSignIn ? parseAuthErrorKind(params.error) : null;

  if (failure) {
    const copy = AUTH_ERROR_COPY[failure];
    return (
      <section className="m-auto w-full max-w-xl px-6 py-20" aria-labelledby="sign-in-error">
        <p className="label-mono">Sign-in</p>
        <h1 id="sign-in-error" className="display mt-5 text-[44px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[56px]">{copy.title}</h1>
        <p role="alert" className="mt-5 text-[16px] leading-[1.6] text-paper-muted">{copy.body}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <GitHubSignIn returnTo={returnTo}>Try again with GitHub</GitHubSignIn>
          {failure === "invite"
            ? <Link href="/join" className="link inline-flex min-h-10 items-center text-[15px]">Ask for early access</Link>
            : <Link href={returnTo} className="link inline-flex min-h-10 items-center text-[15px]">Go back</Link>}
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1000px] flex-1 gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_420px] lg:items-center lg:gap-20 lg:py-24">
      <section>
        {preview ? (
          <>
            <p className="label-mono">Private preview</p>
            <h1 className="display mt-5 max-w-lg text-[48px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[68px]">Sign in with your invite.</h1>
            <p className="mt-6 max-w-lg text-[17px] leading-[1.6] text-paper-dim">opensrcer is open to invited GitHub accounts while it&apos;s in preview. It opens to everyone soon.</p>
            <Link href="/demo/stage" className="link mt-6 inline-flex min-h-11 items-center text-[16px]">Not invited yet? Watch the demo <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
          </>
        ) : (
          <>
            <p className="label-mono">Connect your GitHub account</p>
            <h1 className="display mt-5 max-w-lg text-[48px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[68px]">Pick up where the issue leaves off.</h1>
            <p className="mt-6 max-w-lg text-[17px] leading-[1.6] text-paper-dim">Browse repositories, generate a patch, and review the change before opening a draft pull request.</p>
            <Link href="/demo/stage" className="link mt-8 inline-flex min-h-11 items-center text-[16px]">Explore the demo without signing in <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
          </>
        )}
      </section>

      <section className="card p-6 sm:p-8" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading" className="display text-[28px] leading-[1.05] text-paper">{canSignIn ? "Sign in to opensrcer" : "Sign-in is being configured"}</h2>
        <p className="mt-3 text-[16px] leading-[1.6] text-paper-muted">{canSignIn ? "Authentication is handled by Auth0 using your GitHub account." : "This deployment is available for preview, but its GitHub sign-in is not ready yet."}</p>
        {canSignIn ? (
          <GitHubSignIn returnTo={returnTo} className="btn-primary mt-6 flex min-h-12 w-full gap-3 text-[16px]" />
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            {!preview && <Link href="/demo/stage" className="btn-primary min-h-12 px-6">Explore the demo</Link>}
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
