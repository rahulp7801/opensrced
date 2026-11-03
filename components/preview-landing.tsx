import { Suspense } from "react";
import Link from "next/link";
import { Play } from "@phosphor-icons/react/dist/ssr";
import { InviteNotice } from "./invite-notice";
import { RUN } from "./tour/data";
import { HeroHeadline } from "./landing";
import { CtaPill } from "./brand/pill";
import { GitHubSignIn } from "./github-sign-in";

// What a newcomer needs before anything else: what it does, in plain words.
const STEPS = [
  { title: "Pick an issue", text: "An issue is a bug or task a project has posted publicly. opensrcer points you to ones that are open to newcomers." },
  { title: "Understand the fix", text: "Ask about the code in plain English. An agent writes the fix in an isolated machine and runs the project's tests when it has them." },
  { title: "Review, then publish", text: "Nothing is posted until you've read the change. Then it opens a draft pull request, your proposed change, in your name." },
];

// Why a maintainer can trust what arrives: each is what the product does today.
const TRUST = [
  { title: "Reads the rules first", text: "Every run starts with the project's contributing guide and AI policy. Where AI help isn't wanted, it refuses before writing a line." },
  { title: "Proves the fix", text: "It undoes the change and reruns the project's tests: the new test has to fail without the fix and pass with it." },
  { title: "You explain it, then you publish", text: "Nothing goes out until you've explained the change in your own words. It opens as a draft, one per project, with AI help disclosed." },
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
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-4">
            {/* The demo first: it is what shows people what this is. */}
            <Link href="/demo/stage" className="inline-flex min-h-14 items-center gap-2.5 rounded-full bg-signal px-7 text-[17px] font-semibold text-white shadow-[0_8px_24px_-8px_var(--color-signal)] transition-transform hover:-translate-y-0.5">
              <Play aria-hidden size={18} weight="fill" />Watch the demo
            </Link>
            <CtaPill href="/join">Get early access</CtaPill>
          </div>
          <p className="mt-5 text-[15px] text-paper-muted">Have an invite? <GitHubSignIn returnTo="/discover" icon={false} className="text-link">Continue with GitHub</GitHubSignIn></p>
        </div>
      </HeroHeadline>
      <section aria-label="The demo" className="px-5 pb-10 sm:px-8">
        <Link href="/demo/stage" className="group mx-auto flex max-w-[1320px] flex-col gap-5 rounded-[20px] bg-signal p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <span>
            <span className="block font-mono text-[12px] uppercase tracking-[0.08em] text-white/75">The demo</span>
            <span className="mt-2 block font-display text-[26px] font-[650] leading-[1.15] tracking-[-0.02em] [font-stretch:92%] sm:text-[32px]">Watch an issue become a pull request.</span>
            <span className="mt-2 block max-w-[56ch] text-[16px] leading-[1.5] text-white/85">Click through it at your own pace: find the issue, understand the code, prove the fix, publish. No account needed.</span>
          </span>
          <span className="inline-flex min-h-14 shrink-0 items-center gap-2.5 self-start rounded-full bg-white px-7 text-[17px] font-semibold text-signal transition-transform group-hover:-translate-y-0.5 sm:self-center">
            <Play aria-hidden size={18} weight="fill" />Start the demo
          </span>
        </Link>
      </section>
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
      <section aria-labelledby="trust-heading" className="px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="mx-auto max-w-[1320px] rounded-[20px] bg-surface p-6 sm:p-10">
          <h2 id="trust-heading" className="max-w-[24ch] font-display text-[28px] font-[650] leading-[1.1] tracking-[-0.02em] text-paper [font-stretch:92%] sm:text-[36px]">Built so maintainers can say yes.</h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-10">
            {TRUST.map((t) => (
              <li key={t.title}>
                <p className="text-[18px] font-semibold text-paper">{t.title}</p>
                <p className="mt-2 max-w-[44ch] text-[16px] leading-[1.55] text-paper-muted">{t.text}</p>
              </li>
            ))}
          </ul>
          <Link href="/demo/stage" className="text-link mt-8 inline-flex min-h-11 items-center text-[16px]">See all three in the demo <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
        </div>
      </section>
    </div>
  );
}
