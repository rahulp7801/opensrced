import { DispatchList } from "@/components/dispatch-list";
import { PageHeading } from "@/components/page-heading";

export const metadata = { title: "Runs" };

export default function DispatchesPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Runs</>}
        description="Every fix run the agent has started. Click a row to see the live output as the agent explores the codebase and writes a patch. Every run stops for your review; nothing is published until you confirm."
      />
      <div className="mt-6">
        <DispatchList />
      </div>
    </div>
  );
}
