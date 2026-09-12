"use client";

import { Suspense, type ReactNode } from "react";
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
  return (
    <section className="m-auto w-full max-w-lg px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight text-paper">{isLoading ? "Checking sign-in..." : "Sign in to continue"}</h1>
      <p className="mt-4 text-sm text-paper-muted">Connect your GitHub account to browse repositories, start runs, and view your activity.</p>
      <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-6 inline-flex min-h-12 items-center rounded-md bg-signal px-5 py-3 text-sm font-medium text-ink hover:bg-signal-soft">Sign in with GitHub</Link>
      <p className="mt-4"><Link href="/demo" className="text-sm text-paper-muted underline">Try the interactive demo</Link></p>
    </section>
  );
}
