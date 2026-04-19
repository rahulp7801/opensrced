import { PrTable } from "@/components/pr-table";
import { PageHeading } from "@/components/page-heading";
import { loadAllPRs } from "@/lib/data";

export default async function PRsPage() {
  const prs = await loadAllPRs();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        title={<>Pull requests</>}
        description="Every PR the agent has opened. Filter by state, search by repo or title, open any row on GitHub."
      />
      <div className="mt-6">
        <PrTable prs={prs} />
      </div>
    </div>
  );
}
