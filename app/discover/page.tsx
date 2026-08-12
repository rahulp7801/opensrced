import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { DiscoverScanner } from "@/components/discover-scanner";

export default function DiscoverPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="find something to fix"
        title={<>Browse repos</>}
        description={
          <>
            Search public GitHub repos by stars and language, then browse their open issues
            ranked by solvability. No AI cost — this is free. Click any issue to scan it
            or jump straight to fixing it.
          </>
        }
      />
      <div className="mt-6">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading…</div>}>
          <DiscoverScanner />
        </Suspense>
      </div>
    </div>
  );
}
