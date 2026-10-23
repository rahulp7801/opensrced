"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

export function SessionGate({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
  const path = usePathname();
  if (allowAnonymous || ["/", "/login", "/demo", "/privacy"].includes(path) || path.startsWith("/fix/") || path.startsWith("/demo/")) return children;
  return <Suspense fallback={<p className="p-8 text-sm text-paper-muted">Checking sign-in...</p>}><SignedIn>{children}</SignedIn></Suspense>;
}

function SignedIn({ children }: { children: ReactNode }) {
  const { user, error, isLoading } = useUser();
  const path = usePathname();
  const params = useSearchParams();
  // Once this page has had a user, a later check that fails or comes back empty
  // (the library re-checks on focus) must not unmount it and lose typed work.
  const hadUser = useRef(false);
  if (user) hadUser.current = true;

  const returnTo = path + (params.size ? `?${params.toString()}` : "");
  if (hadUser.current) {
    // The same element shape whether or not the banner shows: returning bare
    // `children` in one case and a fragment in the other would remount the
    // page and lose its state anyway.
    return (
      <>
        {!user && (
          <div className="mx-auto w-full max-w-[1200px] px-5 pt-4 sm:px-8">
            <p role="alert" className="rounded-md border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-alert">
              {error ? "Could not confirm your sign-in." : "Your session has ended."} What you entered on this page is kept.{" "}
              <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`} className="font-medium underline underline-offset-2">Sign in again</a>
            </p>
          </div>
        )}
        {children}
      </>
    );
  }
  if (isLoading) return <SessionLoading returnTo={returnTo} />;
  if (error) return <SessionLoading returnTo={returnTo} failed />;
  return (
    <section className="m-auto w-full max-w-lg px-6 py-20">
      <h1 className="display text-[40px] leading-[1.05] text-paper">Sign in to continue</h1>
      <p className="mt-4 text-sm text-paper-muted">Connect your GitHub account to browse repositories, start runs, and view your activity.</p>
      <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-6 inline-flex min-h-12 items-center rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink hover:bg-signal-soft">Sign in with GitHub</Link>
      <p className="mt-4"><Link href="/demo" className="text-sm text-paper-muted underline">Try the interactive demo</Link></p>
    </section>
  );
}

function SessionLoading({ returnTo, failed = false }: { returnTo: string; failed?: boolean }) {
  const [timedOut, setTimedOut] = useState(failed);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (timedOut) {
    return (
      <section className="m-auto w-full max-w-lg px-6 py-20" role="alert">
        <h1 className="display text-[40px] leading-[1.05] text-paper">{failed ? "Could not check sign-in" : "Sign-in check took too long"}</h1>
        <p className="mt-4 text-sm leading-6 text-paper-muted">
          The authentication service did not respond. Reload this page or start a fresh GitHub sign-in.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-12 rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink hover:bg-signal-soft"
          >
            Reload page
          </button>
          <a
            href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex min-h-12 items-center rounded-md border border-border px-5 py-3 text-sm text-paper hover:border-border-strong"
          >
            Sign in again
          </a>
        </div>
      </section>
    );
  }
  return (
    <section className="m-auto w-full max-w-lg px-6 py-20">
      <h1 className="display text-[40px] leading-[1.05] text-paper">Checking sign-in...</h1>
      <p className="mt-4 text-sm text-paper-muted" role="status">Waiting for the authentication service.</p>
    </section>
  );
}
