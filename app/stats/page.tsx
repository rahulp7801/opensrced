import { PageHeading } from "@/components/page-heading";
import { StatsBoard } from "@/components/stats-board";

export const metadata = { title: "Impact" };

export default function StatsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Impact</>}
        description="What your runs produced: patches, pull requests, and what they cost."
      />

      {/* Dispatch stats */}
      <div>
        <StatsBoard />
      </div>
    </div>
  );
}
