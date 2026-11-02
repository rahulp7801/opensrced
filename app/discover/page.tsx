import { Suspense } from "react";
import { currentHomeProject, HomeProjectBanner } from "@/components/home-project";
import { PageHeading } from "@/components/page-heading";
import { flagEnabled } from "@/lib/flags";
import { DiscoverScanner } from "@/components/discover-scanner";

export const metadata = { title: "Browse repos" };

export default async function DiscoverPage() {
  const lessons = flagEnabled("lessons");
  const home = await currentHomeProject();
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
      <HomeProjectBanner home={home} />
      <div>
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading…</div>}>
          <DiscoverScanner lessons={lessons} home={home} />
        </Suspense>
      </div>
    </div>
  );
}
