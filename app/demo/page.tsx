import type { Metadata } from "next";
import { ProductTour } from "@/components/tour/tour";
import { inviteOnly } from "@/lib/access";

export const metadata: Metadata = {
  title: "Product tour",
  description: "A six-minute, self-running tour of opensrcer: find an issue, watch an agent fix it, review the patch, and ship a draft pull request.",
};

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1260px] px-4 pb-8 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-8 max-w-[860px] sm:mb-10">
        <p className="eyebrow">Product tour</p>
        <h1 className="display mt-4 text-[40px] leading-[1.02] text-paper sm:text-[60px]">Watch an issue become a pull request.</h1>
        <p className="mt-4 max-w-[60ch] text-[17px] leading-[1.5] text-paper-muted sm:text-[19px]">
          A six-minute walkthrough of everything opensrcer does, built around a real run. It plays on its own; pause, skip or step through at any point. Nothing here calls an API or needs an account.
        </p>
      </header>
      <ProductTour inviteOnly={inviteOnly()} />
    </div>
  );
}
