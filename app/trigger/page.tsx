import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { TriggerForm } from "@/components/trigger-form";

export const metadata = { title: "New run" };

export default function TriggerPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>New run</>}
        description={
          <>
            Paste a GitHub repo or issue URL. The AI agent explores the codebase and writes a fix,
            then stops so you can read it. Nothing is posted to GitHub until you confirm it.
          </>
        }
      />

      <div>
        <Suspense fallback={<div className="text-paper-muted text-[13px]">Loading...</div>}>
          <TriggerForm />
        </Suspense>
      </div>

      <section className="mt-16 border-t border-border pt-10 pb-4" aria-labelledby="run-workflow-heading">
        <h2 id="run-workflow-heading" className="display text-[32px] leading-none text-paper sm:text-[40px]">What happens next</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
          {[
            {
              code: "01",
              title: "Inspect the issue",
              body: "The agent reads the issue and the relevant parts of the repository.",
            },
            {
              code: "02",
              title: "Generate a patch",
              body: "You get a proposed change and the agent's check results to review.",
            },
            {
              code: "03",
              title: "You decide what to publish",
              body: "A publishable run waits for you: read the change, explain it in your own words, and only then does it open a draft PR from your account. A preview can only be read.",
            },
          ].map((step) => (
            <li key={step.code} className="border-t-2 border-paper pt-4">
              <span className="kicker text-signal">{step.code}</span>
              <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.01em] text-paper">{step.title}</h3>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-paper-dim">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
