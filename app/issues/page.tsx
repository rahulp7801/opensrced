import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { IssueScanner } from "@/components/issue-scanner";

export const dynamic = "force-dynamic";

export default function IssuesPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="pick what to solve"
        title={<>Issue scanner</>}
        description={
          <>
            Point at any public GitHub repo. The scanner reads every open issue, classifies it
            by category, severity, and complexity, then estimates a rough time-to-fix. You
            pick which one you want opensrcer to solve — nothing runs until you click.
          </>
        }
      />
      <div className="mt-6">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading…</div>}>
          <IssueScanner />
        </Suspense>
      </div>
    </div>
  );
}
