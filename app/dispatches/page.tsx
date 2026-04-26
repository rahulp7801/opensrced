import { DispatchList } from "@/components/dispatch-list";
import { PageHeading } from "@/components/page-heading";

export default function DispatchesPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="active & past runs"
        title={<>Runs</>}
        description="Every fix run the agent has started. Click a row to see the live output as the agent explores the codebase, generates a patch, and opens a PR."
      />
      <div className="mt-6">
        <DispatchList />
      </div>
    </div>
  );
}
