import { DispatchList } from "@/components/dispatch-list";
import { PageHeading } from "@/components/page-heading";

export const dynamic = "force-dynamic";

export default function DispatchesPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="live subprocesses"
        title={<>Dispatches</>}
        description="Every pipeline the dashboard has spawned, with live log tailing. Click a row to view the full output as it streams from the agent."
      />
      <div className="mt-6">
        <DispatchList />
      </div>
    </div>
  );
}
