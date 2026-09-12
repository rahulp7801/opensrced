"use client";

import Link from "next/link";

export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="m-auto w-full max-w-xl px-6 py-20" role="alert">
      <p className="mono-label text-alert">Something went wrong</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-paper">This page could not finish loading.</h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-paper-muted">
        The request may have timed out or a service may be temporarily unavailable. Retry without losing your place.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="min-h-11 bg-signal px-5 py-2.5 text-sm font-medium text-ink hover:bg-signal-soft">
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center border border-border px-5 py-2.5 text-sm text-paper-muted hover:border-border-strong hover:text-paper">
          Back home
        </Link>
      </div>
    </section>
  );
}
