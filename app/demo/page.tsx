import type { Metadata } from "next";
import { ProductTour } from "@/components/tour/tour";
import { inviteOnly } from "@/lib/access";

export const metadata: Metadata = {
  title: "Product tour",
  description: "Click through opensrcer yourself, or watch the tour: find an issue, watch an agent fix it, review the patch, and ship a draft pull request.",
};

// A compact title row, so the tour itself can fill the window below it.
export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-8 pt-4 sm:px-6">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-paper sm:text-[21px]">Product tour: watch an issue become a pull request</h1>
        <p className="text-[13.5px] text-paper-muted">Built around a real run. Nothing here calls an API or needs an account.</p>
      </header>
      <ProductTour inviteOnly={inviteOnly()} />
    </div>
  );
}
