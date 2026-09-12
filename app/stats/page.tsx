import { PageHeading } from "@/components/page-heading";
import { StatsBoard } from "@/components/stats-board";

export default function StatsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        eyebrow="your contributions"
        title={<>Impact</>}
        description="Track recorded runs, patches, pull requests, and provider spend across your work."
      />

      {/* Dispatch stats */}
      <div className="mt-6">
        <StatsBoard />
      </div>
    </div>
  );
}
