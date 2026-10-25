import Link from "next/link";
import { Doodle } from "@/components/brand/doodles";
import { o } from "@/components/brand/doodle-data";

export const metadata = { title: "Page not found" };

// The 404 draws the wordmark's unclosed ring large, captioned like a figure:
// the one doodle here annotates the joke instead of floating in a corner.
export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <div className="grid items-center gap-x-14 gap-y-8 md:grid-cols-[180px_minmax(0,1fr)]">
        <figure className="w-[120px] md:w-[180px]">
          <Doodle doodle={o} weight={0.9} draw="load" delay={150} duration={900} className="size-[120px] md:size-[160px]" />
          <figcaption className="fig mt-4">
            <span className="fig-tag">fig. 404</span>
            <span>a node with no edges</span>
          </figcaption>
        </figure>
        <div className="max-w-2xl">
          <p className="mb-3 font-mono text-[12px] tracking-[0.02em] text-paper-faint">404 / not found</p>
          <h1 className="display text-[40px] leading-[1.02] tracking-[-0.02em] text-paper sm:text-[56px]" style={{ fontWeight: 700 }}>
            This page isn&apos;t on the map.
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-[1.6] text-paper-muted">
            The address may be outdated, or the page may have moved.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/discover" className="btn-primary">
              Back to Find
            </Link>
            <Link href="/" className="text-link">
              Go home
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
