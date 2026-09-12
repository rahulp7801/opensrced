import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { TriggerForm } from "@/components/trigger-form";

export default function TriggerPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8">
      <PageHeading
        title={<>New run</>}
        description={
          <>
            Paste a GitHub repo or issue URL. The AI agent will explore the codebase,
            generate a fix and open a draft PR after the configured checks. Use Preview mode to see what
            the agent finds without opening a PR.
          </>
        }
      />

      <div className="mt-6">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading...</div>}>
          <TriggerForm />
        </Suspense>
      </div>

      <section className="mt-12 border-t border-border py-8" aria-labelledby="run-workflow-heading">
        <h2 id="run-workflow-heading" className="text-base font-medium text-paper">What happens next</h2>
        <ol className="mt-5 grid gap-5 md:grid-cols-3 md:gap-8">
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
              title: "Choose what to publish",
              body: "Live mode opens a draft PR. Run the repository's own tests before merging.",
            },
          ].map((step) => (
            <li key={step.code} className="grid grid-cols-[2rem_1fr] gap-2">
              <span className="pt-0.5 font-mono text-xs text-paper-muted">{step.code}</span>
              <div>
                <h3 className="text-sm font-medium text-paper">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-paper-dim">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
