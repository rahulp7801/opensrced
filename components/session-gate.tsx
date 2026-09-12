"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

export function SessionGate({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
  const path = usePathname();
  if (allowAnonymous || ["/", "/login", "/demo"].includes(path) || path.startsWith("/fix/")) return children;
  return <Suspense fallback={<p className="p-8 text-sm text-paper-muted">Checking sign-in...</p>}><SignedIn>{children}</SignedIn></Suspense>;
}

function SignedIn({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();
  const path = usePathname();
  const params = useSearchParams();

  if (user) return children;
  const returnTo = path + (params.size ? `?${params.toString()}` : "");
  if (isLoading) return <SessionLoading returnTo={returnTo} />;
  return (
    <section className="m-auto w-full max-w-lg px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight text-paper">Sign in to continue</h1>
      <p className="mt-4 text-sm text-paper-muted">Connect your GitHub account to browse repositories, start runs, and view your activity.</p>
      <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-6 inline-flex min-h-12 items-center rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink hover:bg-signal-soft">Sign in with GitHub</Link>
      <p className="mt-4"><Link href="/demo" className="text-sm text-paper-muted underline">Try the interactive demo</Link></p>
    </section>
  );
}

function SessionLoading({ returnTo }: { returnTo: string }) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (timedOut) {
    return (
      <section className="m-auto w-full max-w-lg px-6 py-20" role="alert">
        <h1 className="text-3xl font-semibold tracking-tight text-paper">Sign-in check took too long</h1>
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
      <h1 className="text-3xl font-semibold tracking-tight text-paper">Checking sign-in...</h1>
      <p className="mt-4 text-sm text-paper-muted" role="status">Waiting for the authentication service.</p>
    </section>
  );
}
