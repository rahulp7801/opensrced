import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { TriggerForm } from "@/components/trigger-form";

export default function TriggerPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="fix an issue"
        title={<>New run</>}
        description={
          <>
            Paste a GitHub repo or issue URL. The AI agent will explore the codebase,
            generate a fix, run tests, and open a draft PR. Use Preview mode to see what
            the agent finds without opening a PR.
          </>
        }
      />

      <div className="mt-6 animate-fade-rise">
        <Suspense fallback={<div className="text-paper-muted text-[12px]">Loading...</div>}>
          <TriggerForm />
        </Suspense>
      </div>

      <section className="mt-16">
        <div className="mb-5 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-paper-muted">How it works</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              code: "01",
              title: "Explore",
              body: "The agent clones the repo, builds an AST index, and reads the relevant files using tree-sitter + grep.",
            },
            {
              code: "02",
              title: "Fix",
              body: "Diagnoses the root cause, generates a minimal patch, and verifies it won't break existing code.",
            },
            {
              code: "03",
              title: "Ship",
              body: "Forks the repo, commits the fix, runs the test suite, and opens a draft PR with full context.",
            },
          ].map((step) => (
            <div key={step.code} className="border border-border bg-surface/40 p-5">
              <span className="text-[10px] text-signal uppercase tracking-[0.15em]">{step.code}</span>
              <div className="mt-3 serif text-[28px] text-paper leading-none">
                {step.title}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-paper-dim">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
