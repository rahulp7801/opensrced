import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { DiscoverScanner } from "@/components/discover-scanner";

export const dynamic = "force-dynamic";

export default function DiscoverPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="find something to fix"
        title={<>Discover</>}
        description={
          <>
            Search across public GitHub by star count and language, then sift the surfaced
            issues by recency and difficulty. Deterministic — no LLM, no Anthropic spend.
            Click any row to jump into the scanner with that repo loaded.
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
