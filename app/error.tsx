"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-center px-5 py-16 sm:px-8" role="alert">
      <div className="max-w-2xl">
        <p className="kicker text-alert">Unexpected error</p>
        <h1 className="display mt-4 text-[44px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[64px]">This page could not finish loading.</h1>
        <p className="mt-5 max-w-xl text-[16px] leading-[1.6] text-paper-muted">
          Retry the request. If it fails again, return to issue discovery and start from there.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/issues" className="text-link">
            Browse issues
          </Link>
        </div>
      </div>
    </section>
  );
}
