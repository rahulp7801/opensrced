import { Suspense } from "react";
import Link from "next/link";
import { InviteNotice } from "./invite-notice";

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
    <section className="flex flex-1 flex-col items-center justify-center px-5 py-20 text-center sm:py-28">
      <p className="animate-fade-rise text-[19px] font-semibold tracking-[-0.01em] text-paper sm:text-[21px]">opensrcer</p>
      <h1 className="animate-fade-rise display mx-auto mt-3 max-w-[900px] text-[48px] leading-[1.04] text-paper sm:text-[80px]" style={{ animationDelay: "80ms" }}>
        Issues in. <span className="sm:block">Pull requests out.</span>
      </h1>
      <p className="animate-fade-rise mx-auto mt-6 max-w-[600px] text-balance text-[19px] leading-[1.45] text-paper-muted sm:text-[21px]" style={{ animationDelay: "160ms" }}>
        Your first open-source contribution, guided: an agent drafts the fix, explains it in plain English, and nothing is posted until you&apos;ve reviewed it.
      </p>
      <ol className="animate-fade-rise mx-auto mt-10 grid max-w-[960px] gap-4 text-left sm:grid-cols-3" style={{ animationDelay: "240ms" }}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-2xl border border-border-soft bg-surface p-5">
            <p className="flex items-center gap-2.5 text-[16px] font-semibold text-paper">
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-signal/10 font-mono text-[13px] text-signal">{i + 1}</span>
              {step.title}
            </p>
            <p className="mt-2 text-[15px] leading-[1.5] text-paper-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="animate-fade-rise mx-auto mt-6 max-w-[600px] text-[14px] leading-[1.5] text-paper-muted" style={{ animationDelay: "280ms" }}>
        You bring your own Anthropic API key; you pay your provider per run, usually cents (the tour&apos;s run cost $0.20).
      </p>
      <p className="animate-fade-rise mt-8 inline-flex items-center gap-2 rounded-full bg-surface-3 px-4 py-1.5 text-[14px] font-medium text-paper" style={{ animationDelay: "320ms" }}>
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        Private preview
      </p>
      <Suspense fallback={null}>
        <InviteNotice />
      </Suspense>
      <div className="animate-fade-rise mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3" style={{ animationDelay: "360ms" }}>
        <Link href="/demo" className="btn-primary min-h-11 px-6 text-[17px] transition-[background-color,transform] duration-150 active:scale-[0.97]">
          Watch the product tour
        </Link>
        <Link href="/login" className="inline-flex min-h-11 items-center px-2 text-[17px] text-signal hover:underline">
          Have an invite? Sign in
        </Link>
      </div>
    </section>
  );
}
