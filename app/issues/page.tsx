import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { IssueScanner } from "@/components/issue-scanner";
import { SuggestedIssues } from "@/components/suggested-issues";

export const metadata = { title: "Issues" };

export default function IssuesPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Issues</>}
        description={
          <>
            Pick a suggested beginner issue, or scan any public GitHub repository below. Compare how
            big each fix looks, then choose one to preview or fix. Nothing runs until you choose an action.
          </>
        }
      />

      {/* Suggested issues feed */}
      <div>
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading suggestions...</div>}>
          <SuggestedIssues />
        </Suspense>
      </div>

      {/* Manual scanner */}
      <div className="mt-12">
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading...</div>}>
          <IssueScanner />
        </Suspense>
      </div>
    </div>
  );
}
