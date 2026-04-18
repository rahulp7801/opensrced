import { PageHeading } from "@/components/page-heading";
import { TriggerForm } from "@/components/trigger-form";

export default function TriggerPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow="dispatch · control"
        title={<>Trigger a run</>}
        description={
          <>
            Paste a GitHub repo URL and launch a single pipeline pass. Dry-run skips the fork/PR step — use it for reconnaissance. Or press{" "}
            <kbd className="mx-0.5 px-1.5 py-0.5 border border-border-soft text-paper-muted text-[11px]">⌘K</kbd>{" "}
            from any page to dispatch instantly.
          </>
        }
      />

      <div className="mt-6 animate-fade-rise">
        <TriggerForm />
      </div>

      <section className="mt-16">
        <div className="mb-5 flex items-center gap-3">
          <span className="mono-label text-paper-muted">[protocol]</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              code: "P-01",
              title: "Discovery",
              body: "A single repo is enqueued. No crawl, no filtering — targeted strike.",
            },
            {
              code: "P-02",
              title: "Analysis",
              body: "13-language AST parse · 17 progressive skills · token-budgeted context compression.",
            },
            {
              code: "P-03",
              title: "Dispatch",
              body: "Fork · branch · commit · self-review · quality gate · signed PR with DCO.",
            },
          ].map((step) => (
            <div key={step.code} className="border border-border bg-surface/40 p-5">
              <span className="mono-label text-signal">[{step.code}]</span>
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
