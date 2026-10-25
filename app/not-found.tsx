import Link from "next/link";
import { Doodle } from "@/components/brand/doodles";
import { loop } from "@/components/brand/doodle-data";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <div className="relative max-w-2xl">
        <p className="kicker text-signal">404</p>
        <h1 className="display mt-4 text-[48px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[72px]">Page not found.</h1>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.6] text-paper-dim">
          We looked, and this page isn&apos;t here. Even good maps have blank corners.
        </p>
        <p className="mt-2 max-w-xl text-[16px] leading-[1.6] text-paper-muted">
          The address may be outdated, or the page may have moved.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/discover" className="btn-primary">
            Browse repositories
          </Link>
          <Link href="/" className="btn-quiet">
            Go home
          </Link>
        </div>
        {/* The page's one hand-drawn mark: a loop that wandered off the map. */}
        <Doodle doodle={loop} draw="load" delay={200} className="doodle-thin pointer-events-none absolute -right-48 top-2 hidden h-36 w-48 lg:block" />
      </div>
    </section>
  );
}
