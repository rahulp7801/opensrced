// The landing page: the brand showcase (components/brand/README.md).
//
// Story, top to bottom: the line, beside a code map (hero) → what it holds to
// → the maintainers' problem → what opensrcer is for (an ink-reveal
// manifesto) → how it works, six steps, each with a small piece of real
// product evidence → proof (draft PR #7) → start.
//
// Calm on purpose: sentence-case headlines, generous space, one sticker at
// most, decoration never over text you need to read. Every claim is true of
// the product today; sources are noted next to the copy. All motion is CSS
// (brand.css): the server sends the finished page, so nothing waits for
// hydration and reduced motion gets it as-is.

import Link from "next/link";
import { Sticker } from "./brand/sticker";
import { Doodle } from "./brand/doodles";
import { arrow, nodes, underline } from "./brand/doodle-data";
import { InkReveal } from "./brand/ink-reveal";
import { CodeMap } from "./brand/code-map";
import { CtaPill, ArrowGlyph } from "./brand/pill";

type Cta = { href: string; label: string };

// The verified demo run (components/tour/data.ts): issue #2 → draft PR #7.
const DEMO_PR = "https://github.com/rahulp7801/opensrcer-demo/pull/7";

// What every contribution is held to (the steps below say how).
const PRINCIPLES = ["Tested in a locked box", "Explained in your own words", "Follows the project's rules", "Published as a draft, disclosed"] as const;

// The tour's "problem" chapter, in its own words.
const SLOP = ["Huge diffs", "No tests", "The project's rules ignored", "Nobody who can answer one review question"] as const;

// Six steps. Sources: README "What it does", the tour's trust/fix chapters.
const STEPS: { title: string; copy: string; proof: React.ReactNode }[] = [
  {
    title: "Find an issue that's open to you.",
    copy: "Browse projects by language and activity. Issues that are assigned, already fixed, or too vague to start are flagged before you pick one.",
    proof: (
      <div className="flex flex-wrap gap-2">
        <span className="tag" data-tone="ok">open to you</span>
        <span className="tag" data-tone="alert">assigned</span>
        <span className="tag" data-tone="alert">already fixed</span>
        <span className="tag" data-tone="alert">too vague</span>
        <span className="tag" data-tone="alert">1 open PR already targets this issue</span>
      </div>
    ),
  },
  {
    title: "Understand the code on a map.",
    copy: "Before anything changes, see what the change would touch: who calls it, what depends on it, and why the fix belongs where it does.",
    proof: (
      <div className="flex items-center gap-5">
        <Doodle doodle={nodes} draw="scroll" weight={0.5} className="w-[104px] shrink-0" />
        <p className="font-mono text-[13px] leading-[1.6] text-paper-dim">
          <span className="text-paper">render_template()</span>
          <br />
          31 places depend on it
          <br />
          <span className="text-paper-muted">pallets/flask, on the Explore map</span>
        </p>
      </div>
    ),
  },
  {
    title: "It reads the project's rules first.",
    copy: "The contributing guide, the AI policy, the issue thread. If the guide bans AI-written pull requests, or a maintainer on the issue asks for human-written work, it refuses to publish.",
    proof: (
      <p className="rounded-2xl border border-alert/30 bg-alert/5 px-4 py-3 font-mono text-[13px] leading-[1.6] text-alert">
        Blocked: a maintainer asked for human-written work on this issue.
      </p>
    ),
  },
  {
    title: "The fix is proven in a locked box.",
    copy: "The project's own tests run on the final patch in a machine with no keys, then again with the fix undone, where the new tests have to fail.",
    proof: (
      <dl className="grid max-w-[320px] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 font-mono text-[13px] text-paper-dim">
        <dt>tests, with the fix</dt><dd className="text-ok">pass</dd>
        <dt>tests, fix undone</dt><dd className="text-alert">fail</dd>
        <dt>keys in the machine</dt><dd className="text-paper">none</dd>
      </dl>
    ),
  },
  {
    title: "You explain it in your own words.",
    copy: "Publishing waits until you can say what changed and why. Your explanation is checked against the diff, then you answer a short practice review.",
    proof: (
      <div aria-hidden className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-[15px] text-paper-muted">
        In your words: what changed, and why?
        <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-signal" />
      </div>
    ),
  },
  {
    title: "A person publishes it, disclosed.",
    copy: "A draft pull request opens in your name. It says which model helped and what was and wasn't tested, with an Assisted-by trailer. At most one open pull request per project, and three a day.",
    proof: (
      <p className="font-mono text-[13px] leading-[1.7] text-paper-dim">
        <span className="tag" data-tone="signal">draft</span>
        <br />
        Assisted-by: <span className="text-paper">&lt;model&gt; via opensrcer</span>
      </p>
    ),
  },
];

// Guarantees (README "What it does": read-only tools, a spend or turn limit plus a timeout, drafts).
const FINE_PRINT = [
  "Read-only while it explores.",
  "A hard limit and a timeout on every run.",
  "Drafts only. Nothing merges on its own.",
] as const;

const SECTION = "px-5 sm:px-8";
const WRAP = "mx-auto max-w-[1320px]";
const H2 = "display text-[clamp(36px,4.6vw,68px)] leading-[1.02] text-paper";

export function Landing({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  return (
    <div className="overflow-x-clip">
      <HeroHeadline>
        <p className="rise mt-8 max-w-[38ch] text-[17px] leading-[1.55] text-paper-dim sm:text-[20px]" style={{ "--delay": "200ms" } as React.CSSProperties}>
          Pick an open issue. Understand the code around it. Let an agent write a fix and test it in a locked box.
          Explain it in your own words, then publish a draft in your name, with the AI help disclosed.
        </p>
        <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ "--delay": "280ms" } as React.CSSProperties}>
          <CtaPill href={primary.href}>{primary.label}</CtaPill>
          <Link href={secondary.href} className="text-link ml-2 text-[16px]">{secondary.label}</Link>
        </div>
      </HeroHeadline>

      {/* What every contribution is held to: one quiet, still line. */}
      <div className={`${SECTION} border-y border-border-soft`}>
        <ul className={`${WRAP} flex flex-wrap gap-x-8 gap-y-2 py-5 text-[15px] text-paper-dim`}>
          {PRINCIPLES.map((line) => (
            <li key={line} className="flex items-center gap-2.5">
              <span aria-hidden className="size-1.5 rounded-full bg-signal" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      {/* ── The problem ─────────────────────────────────────────────── */}
      <section aria-labelledby="problem-heading" className={`${SECTION} py-24 sm:py-32`}>
        <div className={`${WRAP} grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`}>
          <div>
            <p className="kicker text-signal">The problem</p>
            <h2 id="problem-heading" className={`${H2} mt-5 max-w-[17ch]`}>
              Maintainers are drowning in AI pull requests{" "}
              <span className="relative inline-block whitespace-nowrap">
                nobody understood.
                {/* Sits under the words, never over them. */}
                <Doodle doodle={underline} draw="scroll" stretch weight={0.55} className="absolute left-0 top-full h-[0.2em] w-[96%]" />
              </span>
            </h2>
          </div>
          <div className="self-end">
            <ul className="border-t-2 border-paper">
              {SLOP.map((line) => (
                <li key={line} className="flex items-baseline gap-4 border-b border-border py-3.5 text-[18px] text-paper-dim">
                  <span aria-hidden className="font-mono text-[13px] text-alert">&#x2715;</span>
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[18px] leading-[1.5] text-paper">
              The problem isn&apos;t AI. It&apos;s contributions nobody understood.
            </p>
          </div>
        </div>
      </section>

      {/* ── What it's for: the manifesto, inking in as you read ─────── */}
      <section aria-labelledby="manifesto-heading" className={`${SECTION} bg-ink-2 py-24 sm:py-32`}>
        <div className={WRAP}>
          <h2 id="manifesto-heading" className="kicker text-paper-muted">What it&apos;s for</h2>
          <InkReveal
            className="display mt-8 max-w-[24ch] text-[clamp(32px,4.4vw,64px)] leading-[1.08] text-paper"
            text="Not more pull requests. Better ones. The contribution a maintainer would actually want: tested, explained, and following the project's rules."
          />
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section aria-labelledby="how-heading" className={`${SECTION} py-24 sm:py-32`}>
        <div className={WRAP}>
          <p className="kicker text-signal">How it works</p>
          <h2 id="how-heading" className={`${H2} mt-5 max-w-[20ch]`}>From an open issue to a draft you can defend.</h2>
          <ol className="mt-14 border-t-2 border-paper sm:mt-16">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid gap-x-10 gap-y-4 border-b border-border py-9 sm:py-11 lg:grid-cols-[96px_minmax(0,6fr)_minmax(0,5fr)]">
                <span aria-hidden className="display text-[36px] leading-none text-signal sm:text-[44px]">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="display text-[clamp(24px,2.4vw,34px)] leading-[1.1] text-paper">{step.title}</h3>
                  <p className="mt-3 max-w-[58ch] text-[17px] leading-[1.6] text-paper-dim">{step.copy}</p>
                </div>
                <div className="min-w-0 self-center">{step.proof}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Proof, on ink ────────────────────────────────────────────── */}
      <section aria-labelledby="proof-heading" className={`${SECTION} bg-paper py-24 text-ink sm:py-32`}>
        <div className={`${WRAP} grid items-center gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]`}>
          <p aria-hidden className="display text-[clamp(120px,15vw,220px)] leading-[0.85] text-signal-dim">#7</p>
          <div>
            <p className="kicker text-signal-dim">Proof</p>
            <h2 id="proof-heading" className="display mt-5 text-[clamp(32px,4vw,56px)] leading-[1.04]">
              One real run, on the record.
            </h2>
            <p className="mt-5 max-w-[56ch] text-[18px] leading-[1.6] text-[#d9cdc4]">
              Draft pull request #7 on rahulp7801/opensrcer-demo, our demo repository, came out of a real, verified run.
              The project&apos;s tests pass with the fix and fail without it.
            </p>
            <a
              href={DEMO_PR}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex min-h-12 items-center gap-3 rounded-full bg-ink py-1.5 pl-5 pr-1.5 text-[16px] font-semibold text-paper transition-transform active:scale-[0.97]"
            >
              Read pull request #7 on GitHub
              <span className="grid size-9 place-items-center rounded-full bg-signal text-white"><ArrowGlyph size={15} /></span>
            </a>
          </div>
        </div>
      </section>

      {/* ── Start ────────────────────────────────────────────────────── */}
      <section aria-labelledby="start-heading" className={`${SECTION} pb-6 pt-24 sm:pt-32`}>
        <div className={WRAP}>
          <h2 id="start-heading" className="display text-[clamp(44px,6.4vw,96px)] leading-[0.98] tracking-[-0.03em] text-paper">
            Start with <span className="text-signal">one issue.</span>
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <CtaPill href={primary.href}>{primary.label}</CtaPill>
            <Link href={secondary.href} className="text-link ml-2 text-[16px]">{secondary.label}</Link>
            <Doodle doodle={arrow} draw="scroll" weight={0.55} className="ml-3 hidden w-[96px] -scale-x-100 -rotate-12 sm:block" />
          </div>
          <ul className="mt-20 grid gap-4 border-t border-border pt-6 text-[16px] text-paper-muted sm:grid-cols-3">
            {FINE_PRINT.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

/** The hero: the line (sentence case, one cobalt word, one small sticker) beside
 *  the code map. Shared with the private-preview page
 *  (components/preview-landing.tsx), which brings its own copy as children. */
export function HeroHeadline({ children }: { children?: React.ReactNode }) {
  return (
    <section className={`${SECTION} pb-20 pt-14 sm:pb-24 sm:pt-20`}>
      <div className={`${WRAP} grid items-center gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`}>
        <div>
          <p className="kicker rise text-paper-muted">Your first open-source contribution, guided</p>
          <h1 className="rise mt-6 font-display text-[clamp(46px,6.2vw,96px)] font-extrabold leading-[0.98] tracking-[-0.02em] text-paper [font-stretch:88%]" style={{ "--delay": "60ms" } as React.CSSProperties}>
            Issues in.
            <Sticker tone="ink" tilt={-2} delay={800} className="ml-[0.35em] align-[0.5em] text-[clamp(12px,1vw,15px)] tracking-normal">
              <span aria-hidden>Drafts only</span>
            </Sticker>
            <br />
            Pull requests <span className="text-signal">out.</span>
          </h1>
          {children}
        </div>
        <figure className="mx-auto w-full max-w-[460px] lg:max-w-none">
          <CodeMap label="render_template()" className="w-full" />
          <figcaption className="mt-3 max-w-[46ch] text-[15px] leading-[1.5] text-paper-muted">
            A sketch of the idea. On the real Explore map of pallets/flask, 31 places depend on{" "}
            <code className="font-mono text-[14px] text-paper">render_template()</code>; you see them before you change it.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
