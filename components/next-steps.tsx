// "What happens next" after a pull request opens (lib/beginner-guide.ts):
// the draft, the wait, the etiquette, and where the follow-up help lives.

import { AFTER_PUBLISH } from "@/lib/beginner-guide";
import { Term } from "./term";

export function NextSteps({ heading = "What happens next" }: { heading?: string }) {
  return (
    <div className="text-[14px] leading-[1.6]">
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-paper">{heading}</h3>
      <ol className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {AFTER_PUBLISH.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-1">
            <span className="kicker pt-[3px] text-signal">{String(i + 1).padStart(2, "0")}</span>
            <span><span className="font-semibold text-paper">{step.title}{/[.?!]$/.test(step.title) ? "" : "."}</span> <span className="text-paper-dim">{step.body}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 text-[13px] text-paper-muted">
        <span>Words used here:</span>
        <Term term="draft PR" /><Term term="maintainer" /><Term term="CI" />
      </p>
    </div>
  );
}
