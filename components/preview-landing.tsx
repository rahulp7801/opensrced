import { Suspense } from "react";
import Link from "next/link";
import { InviteNotice } from "./invite-notice";
import { RUN } from "./tour/data";
import { HeroHeadline } from "./landing";
import { CtaPill } from "./brand/pill";
import { Sticker } from "./brand/sticker";

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
    <HeroHeadline>
      <div className="mt-12 grid gap-10 sm:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="rise" style={{ "--delay": "300ms" } as React.CSSProperties}>
          <Sticker tone="signal" tilt={-3} delay={1200}>Private preview</Sticker>
          <p className="mt-6 max-w-[34ch] text-[19px] leading-[1.45] text-paper-dim sm:text-[22px]">
            An agent drafts the fix, explains it in plain English, and nothing is posted until you&apos;ve reviewed it.
          </p>
          <p className="mt-5 max-w-[48ch] text-[14px] leading-[1.5] text-paper-muted">
            You bring your own Anthropic API key; you pay your provider per run, usually cents (the tour&apos;s run cost ${RUN.cost.toFixed(2)}).
          </p>
          <Suspense fallback={null}>
            <InviteNotice />
          </Suspense>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CtaPill href="/demo">Watch the product tour</CtaPill>
            <Link href="/login" className="pill min-h-12 px-5 text-[16px]">Have an invite? Sign in</Link>
          </div>
        </div>
        <ol className="rise border-t-2 border-paper" style={{ "--delay": "380ms" } as React.CSSProperties}>
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 border-b border-border py-5">
              <span aria-hidden className="shout text-[40px] text-signal">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="display text-[24px] leading-[1.05] text-paper">{step.title}</p>
                <p className="mt-2 text-[15px] leading-[1.5] text-paper-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </HeroHeadline>
  );
}
