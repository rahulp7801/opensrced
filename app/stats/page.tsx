import { PageHeading } from "@/components/page-heading";
import { StatsBoard } from "@/components/stats-board";

export const dynamic = "force-dynamic";

export default function StatsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="how much did we ship"
        title={<>Stats</>}
        description={
          <>
            Live counters from the opensrcer observatory: scans run, dispatches fired, PRs
            opened, and the repos where your contributions landed biggest. Derived from
            actual dispatch logs on disk — not seed data.
          </>
        }
      />
      <div className="mt-6">
        <StatsBoard />
      </div>
    </div>
  );
}
