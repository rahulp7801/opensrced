import { DispatchList } from "@/components/dispatch-list";
import { PageHeading } from "@/components/page-heading";

export const metadata = { title: "Runs" };

export default function DispatchesPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>Runs</>}
        description="Every run stops for your review: nothing is published until you confirm it."
      />
      <div>
        <DispatchList />
      </div>
    </div>
  );
}
