"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16 sm:px-8" role="alert">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-alert">Unexpected error</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-paper">This page could not finish loading.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-paper-muted">
        Retry the request. If it fails again, return to issue discovery and start from there.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-md bg-signal px-5 py-2.5 text-sm font-medium text-ink hover:bg-signal-soft"
        >
          Try again
        </button>
        <Link
          href="/issues"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-5 py-2.5 text-sm text-paper hover:border-border-strong"
        >
          Browse issues
        </Link>
      </div>
    </section>
  );
}
