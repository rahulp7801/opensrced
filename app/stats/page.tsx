import { PageHeading } from "@/components/page-heading";
import { StatsBoard } from "@/components/stats-board";
import { ContributionStreaks } from "@/components/contribution-streaks";

export default function StatsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="your contributions"
        title={<>Impact</>}
        description="Track your contribution activity, streaks, and impact across open-source repos."
      />

      {/* Contribution calendar */}
      <div className="mt-6">
        <ContributionStreaks />
      </div>

      {/* Dispatch stats */}
      <div className="mt-6">
        <StatsBoard />
      </div>
    </div>
  );
}
