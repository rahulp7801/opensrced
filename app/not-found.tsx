import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-paper-faint">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-paper">Page not found.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-paper-muted">
        The address may be outdated, or the page may have moved.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href="/discover"
          className="inline-flex min-h-11 items-center rounded-md bg-signal px-5 py-2.5 text-sm font-medium text-ink hover:bg-signal-soft"
        >
          Browse repositories
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-5 py-2.5 text-sm text-paper hover:border-border-strong"
        >
          Go home
        </Link>
      </div>
    </section>
  );
}
