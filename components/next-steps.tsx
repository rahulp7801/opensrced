// "What happens next" after a pull request opens (lib/beginner-guide.ts):
// the draft, the wait, the etiquette, and where the follow-up help lives.

import { AFTER_PUBLISH } from "@/lib/beginner-guide";
import { Term } from "./term";

export function NextSteps({ heading = "What happens next" }: { heading?: string }) {
  return (
    <div className="text-[12px]">
      <h3 className="text-[13px] font-medium text-paper">{heading}</h3>
      <ol className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {AFTER_PUBLISH.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[1.25rem_1fr] gap-1.5">
            <span className="font-mono text-paper-faint">{i + 1}.</span>
            <span><span className="font-medium text-paper">{step.title}.</span> <span className="text-paper-dim">{step.body}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-paper-muted">
        <span>Words used here:</span>
        <Term term="draft PR" /><Term term="maintainer" /><Term term="CI" />
      </p>
    </div>
  );
}
