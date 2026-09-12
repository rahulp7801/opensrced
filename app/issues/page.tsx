import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { IssueScanner } from "@/components/issue-scanner";
import { SuggestedIssues } from "@/components/suggested-issues";

export default function IssuesPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        eyebrow="pick what to solve"
        title={<>Issues</>}
        description={
          <>
            Point at any public GitHub repo. The scanner reads every open issue, classifies it
            by category, severity, and complexity, then estimates a rough time-to-fix. You
            pick which one you want opensrcer to solve — nothing runs until you click.
          </>
        }
      />

      {/* Suggested issues feed */}
      <div className="mt-6">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading suggestions...</div>}>
          <SuggestedIssues />
        </Suspense>
      </div>

      {/* Manual scanner */}
      <div className="mt-8">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading...</div>}>
          <IssueScanner />
        </Suspense>
      </div>
    </div>
  );
}
