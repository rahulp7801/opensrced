import { Suspense } from "react";
import { currentHomeProject, HomeProjectBanner } from "@/components/home-project";
import { PageHeading } from "@/components/page-heading";
import { RecordFeed } from "@/components/record-feed";
import { flagEnabled } from "@/lib/flags";
import { IssueScanner } from "@/components/issue-scanner";
import { SuggestedIssues } from "@/components/suggested-issues";

export const metadata = { title: "Issues" };

export default async function IssuesPage() {
  const lessons = flagEnabled("lessons");
  const home = await currentHomeProject();
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Issues</>}
        description={
          <>
            Pick a suggested beginner issue or scan any public repository; nothing runs until you choose.
          </>
        }
      />

      {/* From the record: alerts, "Next in <area>", the home project. */}
      {flagEnabled("record") && <RecordFeed />}
      <HomeProjectBanner home={home} />

      {/* Suggested issues feed */}
      <div>
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading suggestions...</div>}>
          <SuggestedIssues lessons={lessons} home={home} />
        </Suspense>
      </div>

      {/* Manual scanner */}
      <div className="mt-12">
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading...</div>}>
          <IssueScanner lessons={lessons} />
        </Suspense>
      </div>
    </div>
  );
}
