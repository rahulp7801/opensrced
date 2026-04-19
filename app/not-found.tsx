import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <div className="serif text-[96px] leading-none text-paper-faint">404</div>
        <h1 className="mt-4 serif text-[24px] text-paper">Page not found</h1>
        <p className="mt-2 text-[13px] text-paper-muted max-w-sm mx-auto">
          The route you requested doesn&apos;t exist. It may have been moved or you may have mistyped the URL.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/"
            className="border border-border bg-surface/60 hover:bg-surface px-4 py-2 text-[12px] text-paper transition"
          >
            Home
          </Link>
          <Link
            href="/discover"
            className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-4 py-2 text-[12px] transition"
          >
            Discover issues
          </Link>
        </div>
      </div>
    </div>
  );
}
