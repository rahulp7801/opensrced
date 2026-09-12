import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { DiscoverScanner } from "@/components/discover-scanner";

export default function DiscoverPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Browse repos</>}
        description={
          <>
            Search public GitHub repositories by stars and language, then compare their open
            issues by scope and complexity. Search uses GitHub only and does not consume AI credits.
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
