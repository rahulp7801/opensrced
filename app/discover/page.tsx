import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { flagEnabled } from "@/lib/flags";
import { DiscoverScanner } from "@/components/discover-scanner";

export const metadata = { title: "Browse repos" };

export default function DiscoverPage() {
  const lessons = flagEnabled("lessons");
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Browse repos</>}
        description={
          <>
            Search public repositories by stars and language and compare their open issues; it
            uses GitHub only, so it costs no AI credits.
          </>
        }
      />
      <div>
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading…</div>}>
          <DiscoverScanner lessons={lessons} />
        </Suspense>
      </div>
    </div>
  );
}
