// The landing page: the brand showcase (components/brand/README.md).
//
// Story, top to bottom: the line (hero) → the maintainers' problem → what
// opensrcer is for (an ink-reveal manifesto) → how it works, six steps, each
// with a small piece of real product evidence → proof (draft PR #7) → start.
//
// Every claim here is true of the product today; the sources are noted next
// to the copy. All motion is CSS (brand.css): the server sends the finished
// page, so nothing waits for hydration and reduced motion gets it as-is.
// The one client island is the curved marquee.

import Link from "next/link";
import { Sticker } from "./brand/sticker";
import { Doodle } from "./brand/doodles";
import { arrow, circle, heroLoop, nodes, spark, underline } from "./brand/doodle-data";
import { Marquee } from "./brand/marquee";
import { InkReveal } from "./brand/ink-reveal";
import { CtaPill, ArrowGlyph } from "./brand/pill";

type Cta = { href: string; label: string };

// The verified demo run (components/tour/data.ts): issue #2 → draft PR #7.
const DEMO_PR = "https://github.com/rahulp7801/opensrcer-demo/pull/7";

const TICKER = ["Tested", "Explained", "Follows the rules", "Drafts only", "Not more PRs, better ones"] as const;

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
        <Doodle doodle={nodes} draw="scroll" className="w-[118px] shrink-0" />
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
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 font-mono text-[13px] text-paper-dim">
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

export function Landing({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  return (
    <div className="overflow-x-clip">
      <Hero primary={primary} secondary={secondary} />

      <Marquee items={TICKER} curved className="-mt-6 sm:-mt-10" />

      {/* ── The problem ─────────────────────────────────────────────── */}
      <section aria-labelledby="problem-heading" className="px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28">
        <div className="mx-auto grid max-w-[1320px] gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div>
            <p className="kicker text-signal">The problem</p>
            <h2 id="problem-heading" className="display mt-5 text-[clamp(40px,5.8vw,84px)] leading-[0.96] text-paper">
              Maintainers are drowning in AI pull requests{" "}
              <span className="relative inline-block whitespace-nowrap">
                nobody understood.
                <Doodle doodle={circle} draw="scroll" stretch className="absolute -inset-x-[7%] -inset-y-[22%] h-[144%] w-[114%]" />
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
      <section aria-labelledby="manifesto-heading" className="bg-ink-2 px-5 py-24 sm:px-8 sm:py-36">
        <div className="relative mx-auto max-w-[1320px]">
          <h2 id="manifesto-heading" className="kicker text-paper-muted">What it&apos;s for</h2>
          <InkReveal
            className="display mt-8 max-w-[19ch] text-[clamp(38px,6vw,92px)] leading-[0.98] text-paper"
            text="Not more pull requests. Better ones. The contribution a maintainer would actually want: tested, explained, and following the project's rules."
          />
          <Sticker tone="signal" tilt={6} pop="scroll" className="absolute right-[4%] top-[18%] hidden md:inline-flex">
            Not slop
          </Sticker>
          <Doodle doodle={spark} draw="scroll" className="absolute bottom-[-6%] right-[10%] hidden w-[86px] md:block" />
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section aria-labelledby="how-heading" className="px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-[1320px]">
          <p className="kicker text-signal">How it works</p>
          <h2 id="how-heading" className="display mt-5 max-w-[17ch] text-[clamp(40px,5.8vw,84px)] leading-[0.96] text-paper">
            From an open issue to a draft you can{" "}
            <span className="relative inline-block">
              defend.
              <Doodle doodle={underline} draw="scroll" stretch className="absolute -bottom-[0.2em] left-[-2%] h-[0.32em] w-[104%]" />
            </span>
          </h2>
          <ol className="mt-16 border-t-2 border-paper sm:mt-20">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid gap-x-10 gap-y-5 border-b border-border py-9 sm:py-12 lg:grid-cols-[132px_minmax(0,6fr)_minmax(0,5fr)]">
                <span aria-hidden className="shout text-[56px] text-signal sm:text-[72px]">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="display text-[clamp(28px,3vw,42px)] leading-[1.02] text-paper">{step.title}</h3>
                  <p className="mt-4 max-w-[54ch] text-[17px] leading-[1.55] text-paper-dim">{step.copy}</p>
                </div>
                <div className="min-w-0 self-center">{step.proof}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Proof, on ink ────────────────────────────────────────────── */}
      <section aria-labelledby="proof-heading" className="bg-paper px-5 py-24 text-ink sm:px-8 sm:py-32">
        <div className="mx-auto grid max-w-[1320px] items-center gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="relative w-fit">
            <p aria-hidden className="shout text-[clamp(150px,22vw,320px)] text-ink">#7</p>
            <Doodle doodle={circle} draw="scroll" stretch className="absolute -inset-x-[9%] -inset-y-[6%] h-[112%] w-[118%] text-signal-dim" tone="current" />
          </div>
          <div>
            <p className="kicker text-signal-dim">Proof</p>
            <h2 id="proof-heading" className="display mt-5 text-[clamp(36px,4.6vw,68px)] leading-[0.98]">
              One real run, on the record.
            </h2>
            <p className="mt-6 max-w-[48ch] text-[18px] leading-[1.55] text-[#d9cdc4]">
              Draft pull request #7 on rahulp7801/opensrcer-demo, our demo repository, came out of a real, verified run.
              The project&apos;s tests pass with the fix and fail without it.
            </p>
            <a
              href={DEMO_PR}
              target="_blank"
              rel="noreferrer"
              className="mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-ink py-1.5 pl-5 pr-1.5 text-[16px] font-semibold text-paper transition-transform active:scale-[0.97]"
            >
              Read pull request #7 on GitHub
              <span className="grid size-9 place-items-center rounded-full bg-signal text-white"><ArrowGlyph size={15} /></span>
            </a>
          </div>
        </div>
      </section>

      {/* ── Start ────────────────────────────────────────────────────── */}
      <section aria-labelledby="start-heading" className="px-5 pb-8 pt-24 sm:px-8 sm:pt-32">
        <div className="relative mx-auto max-w-[1320px]">
          <h2 id="start-heading" className="shout text-[clamp(60px,11vw,170px)] text-paper">
            Start with <span className="text-signal">one issue.</span>
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <CtaPill href={primary.href}>{primary.label}</CtaPill>
            <Link href={secondary.href} className="pill min-h-12 px-5 text-[16px]">{secondary.label}</Link>
            <Doodle doodle={arrow} draw="scroll" className="ml-3 hidden w-[120px] -scale-x-100 -rotate-12 sm:block" />
          </div>
          <ul className="mt-20 grid gap-4 border-t border-border pt-6 text-[15px] text-paper-muted sm:grid-cols-3">
            {FINE_PRINT.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Hero({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  return (
    <HeroHeadline>
      <div className="mt-12 grid gap-8 sm:mt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-end">
        <p className="rise max-w-[36ch] text-[19px] leading-[1.45] text-paper-dim sm:text-[22px]" style={{ "--delay": "300ms" } as React.CSSProperties}>
          Pick an open issue. Understand the code around it. Let an agent write a fix and test it in a locked box.
          Explain it in your own words, then publish a draft in your name, with the AI help disclosed.
        </p>
        <div className="rise flex flex-wrap items-center gap-3 lg:justify-end" style={{ "--delay": "380ms" } as React.CSSProperties}>
          <CtaPill href={primary.href}>{primary.label}</CtaPill>
          <Link href={secondary.href} className="pill min-h-12 px-5 text-[16px]">{secondary.label}</Link>
        </div>
      </div>
    </HeroHeadline>
  );
}

/** The hero's line, stickers and loop; shared with the private-preview page
 *  (components/preview-landing.tsx), which brings its own copy below it. */
export function HeroHeadline({ children }: { children?: React.ReactNode }) {
  return (
    <section className="relative px-5 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-16">
      {/* The big pen loop, in the open space beside the short first line. */}
      <Doodle
        doodle={heroLoop}
        draw="load"
        delay={300}
        duration={1400}
        className="absolute left-[48%] top-[64px] w-[72vw] sm:left-[46%] sm:top-[40px] sm:w-[56vw] lg:left-[47%] lg:top-[34px] lg:w-[min(46vw,700px)]"
      />
      <div className="relative mx-auto max-w-[1320px]">
        <p className="kicker rise text-paper-muted">Your first open-source contribution, guided</p>
        <h1 className="shout mt-6 text-[clamp(60px,16vw,210px)] lg:text-[clamp(60px,14vw,210px)] text-paper">
          <span className="rise block" style={{ "--delay": "60ms" } as React.CSSProperties}>
            Issues{" "}
            <span className="relative inline-block">
              in.
              <Sticker tone="ink" tilt={-8} delay={750} className="absolute left-[78%] top-[2%] text-[clamp(12px,1.3vw,18px)]">
                <span aria-hidden>Drafts only</span>
              </Sticker>
            </span>
          </span>
          <span className="rise block" style={{ "--delay": "160ms" } as React.CSSProperties}>
            Pull{" "}
            <span className="relative inline-block">
              requests
              <Sticker tone="signal" tilt={4} delay={900} className="absolute bottom-[-34%] left-[6%] text-[clamp(12px,1.3vw,18px)] sm:bottom-[-6%] sm:left-[18%]">
                <span aria-hidden>Tested in a locked box</span>
              </Sticker>
            </span>{" "}
            <span className="relative inline-block text-signal">
              out.
              <Sticker tone="paper" tilt={-5} delay={1050} className="absolute right-[-12%] top-[-14%] hidden text-[clamp(12px,1.3vw,18px)] sm:inline-flex">
                <span aria-hidden>In your own words</span>
              </Sticker>
            </span>
          </span>
        </h1>
        {children}
      </div>
    </section>
  );
}
