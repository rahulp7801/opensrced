import { Suspense } from "react";
import Link from "next/link";
import { InviteNotice } from "./invite-notice";
import { RUN } from "./tour/data";
import { HeroHeadline } from "./landing";
import { CtaPill } from "./brand/pill";

// What a newcomer needs before anything else: what it does, in plain words.
const STEPS = [
  { title: "Pick an issue", text: "An issue is a bug or task a project has posted publicly. opensrcer points you to ones that are open to newcomers." },
  { title: "Understand the fix", text: "Ask about the code in plain English. An agent writes the fix in an isolated machine and runs the project's tests when it has them." },
  { title: "Review, then publish", text: "Nothing is posted until you've read the change. Then it opens a draft pull request, your proposed change, in your name." },
];

/** The public page during the invite-only preview (lib/access.ts): the line,
 *  how it works, and a way in for invited accounts. The full landing page
 *  (components/landing.tsx) comes back when OPENSRCER_ACCESS is unset. */
export function PreviewLanding() {
  return (
    <div className="overflow-x-clip">
      <HeroHeadline>
        <div className="rise" style={{ "--delay": "200ms" } as React.CSSProperties}>
          <p className="mt-8 max-w-[38ch] text-[17px] leading-[1.55] text-paper-dim sm:text-[20px]">
            An agent drafts the fix, explains it in plain English, and nothing is posted until you&apos;ve reviewed it.
          </p>
          <p className="mt-4 max-w-[52ch] text-[16px] leading-[1.55] text-paper-muted">
            You bring your own Anthropic API key; you pay your provider per run, usually cents (the tour&apos;s run cost ${RUN.cost.toFixed(2)}).
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-[14px] font-medium text-paper">
            <span aria-hidden className="size-1.5 rounded-full bg-signal" />
            Private preview
          </p>
          <Suspense fallback={null}>
            <InviteNotice />
          </Suspense>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CtaPill href="/demo">Watch the product tour</CtaPill>
            <Link href="/login" className="text-link ml-2 text-[16px]">Have an invite? Sign in</Link>
          </div>
        </div>
      </HeroHeadline>
      <section aria-label="How it works" className="px-5 pb-8 sm:px-8">
        <ol className="mx-auto grid max-w-[1320px] gap-x-10 border-t border-border-soft sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-b border-border-soft py-7 sm:border-b-0">
              <span aria-hidden className="font-mono text-[12px] text-paper-faint">{i + 1}</span>
              <p className="mt-2 font-display text-[22px] font-[650] leading-[1.2] text-paper [font-stretch:92%]">{step.title}</p>
              <p className="mt-2 max-w-[44ch] text-[16px] leading-[1.55] text-paper-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
