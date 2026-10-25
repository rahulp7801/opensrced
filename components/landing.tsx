// The landing page (components/brand/README.md).
//
// An editorial page, not a template: a sentence-case claim beside the code
// map, a mono receipt of real proof, then numbered sections with their labels
// in a left rail: the maintainers' problem → what opensrcer is for (the one
// ink-reveal paragraph) → how it works (a ruled list, each step with a piece
// of real product text) → proof (draft PR #7) → start.
//
// Rules this page keeps: one primary action per view (the CtaPill only in the
// hero), secondary actions as text links, one cobalt thing per view, body
// copy 17px+ and under 70ch, decoration only where it annotates something.
// Every claim is true of the product today; sources are noted by the copy.
// Motion is CSS only (brand.css), so the server sends the finished page.

import Link from "next/link";
import { Doodle } from "./brand/doodles";
import { underline } from "./brand/doodle-data";
import { InkReveal } from "./brand/ink-reveal";
import { CodeMap } from "./brand/code-map";
import { CtaPill } from "./brand/pill";

type Cta = { href: string; label: string };

// The verified demo run (components/tour/data.ts: REPORT, PR_BODY): issue #2 →
// draft PR #7, whose body has "Tests run" (fail reverted, pass with the fix)
// and an "AI assistance" section.
const DEMO_PR = "https://github.com/rahulp7801/opensrcer-demo/pull/7";

const MONO_META = "font-mono text-[13px] leading-[1.7] text-paper-muted";

// Six steps. Sources: README "What it does", the tour's trust/fix chapters.
const STEPS: { title: string; copy: string; proof: React.ReactNode }[] = [
  {
    title: "Find an issue that's open to you.",
    copy: "Browse projects by language and activity. Issues that are assigned, already fixed, or too vague to start are flagged before you pick one.",
    proof: (
      <p className={MONO_META}>
        <Dot tone="ok" />open to you
        <br />
        <Dot tone="alert" />assigned · already fixed · too vague
        <br />
        <Dot tone="alert" />1 open PR already targets this issue
      </p>
    ),
  },
  {
    title: "Understand the code on a map.",
    copy: "Before anything changes, see what the change would touch: who calls it, what depends on it, and why the fix belongs where it does.",
    proof: (
      <p className={MONO_META}>
        <span className="text-paper">render_template()</span> · 31 places depend on it
        <br />
        pallets/flask, on the Explore map
      </p>
    ),
  },
  {
    title: "It reads the project's rules first.",
    copy: "The contributing guide, the AI policy, the issue thread. If the guide bans AI-written pull requests, or a maintainer on the issue asks for human-written work, it refuses to publish.",
    proof: (
      <p className={MONO_META}>
        <Dot tone="alert" /><span className="text-alert">Blocked:</span> a maintainer asked for human-written work on this issue.
      </p>
    ),
  },
  {
    title: "The fix is proven in a locked box.",
    copy: "The project's own tests run on the final patch in a machine with no keys, then again with the fix undone, where the new tests have to fail.",
    proof: (
      <dl className={`${MONO_META} grid max-w-[300px] grid-cols-[1fr_auto] gap-x-6`}>
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
      <p className={MONO_META}>
        a. What was wrong?
        <br />
        b. What did the change do?
        <br />
        c. How do you know it works?
      </p>
    ),
  },
  {
    title: "A person publishes it, disclosed.",
    copy: "A draft pull request opens in your name. It says which model helped and what was and wasn't tested, with an Assisted-by trailer. At most one open pull request per project, and three a day.",
    proof: (
      <p className={MONO_META}>
        draft · opened in your name
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

// A run-in heading: a bold claim in the display face that runs into a quieter
// sentence in the sans, at the same size (the editorial contrast).
const RUN_IN = "font-display text-[clamp(26px,2.8vw,38px)] font-[650] leading-[1.18] text-paper [font-stretch:92%]";
const RUN_IN_REST = "font-sans font-[450] text-paper-muted [font-stretch:100%]";

export function Landing({ primary, secondary }: { primary: Cta; secondary: Cta }) {
  return (
    <div className="overflow-x-clip">
      <HeroHeadline>
        <p className="rise mt-7 max-w-[40ch] text-[17px] leading-[1.6] text-paper-dim sm:text-[19px]" style={{ "--delay": "160ms" } as React.CSSProperties}>
          Pick an open issue. Understand the code around it. Let an agent write a fix and test it in a locked box.
          Explain it in your own words, then publish a draft in your name, with the AI help disclosed.
        </p>
        <div className="rise mt-9 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ "--delay": "240ms" } as React.CSSProperties}>
          <CtaPill href={primary.href}>{primary.label}</CtaPill>
          <Link href={secondary.href} className="text-link text-[16px]">{secondary.label}</Link>
        </div>
        {/* The receipt: three real facts, the first linking to its proof. */}
        <p className="rise mt-7 font-mono text-[12px] leading-[1.7] text-paper-faint" style={{ "--delay": "300ms" } as React.CSSProperties}>
          <a href={DEMO_PR} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-paper">
            PR #7 on rahulp7801/opensrcer-demo
          </a>
          {" · "}tests fail without the fix, pass with it{" · "}AI help disclosed
        </p>
      </HeroHeadline>

      <Section n={1} label="The problem" id="problem-heading">
        <h2 id="problem-heading" className={`${RUN_IN} max-w-[36ch]`}>
          Maintainers are drowning in AI pull requests.{" "}
          <span className={RUN_IN_REST}>
            Huge diffs, no tests, the project&apos;s rules ignored, and nobody who can answer one review question. The problem isn&apos;t AI. It&apos;s contributions nobody understood.
          </span>
        </h2>
      </Section>

      <Section n={2} label="What it's for" id="manifesto-heading">
        <h2 id="manifesto-heading" className="sr-only">What it&apos;s for</h2>
        <InkReveal
          className="display max-w-[24ch] text-[clamp(32px,4.2vw,58px)] leading-[1.08] text-paper"
          text="Not more pull requests. Better ones. The contribution a maintainer would actually want: tested, explained, and following the project's rules."
        />
      </Section>

      <Section n={3} label="How it works" id="how-heading">
        <h2 id="how-heading" className={`${RUN_IN} max-w-[36ch]`}>
          From an open issue to a draft you can defend.{" "}
          <span className={RUN_IN_REST}>Six steps, and what you see at each one.</span>
        </h2>
        <ol className="mt-12 border-b border-border-soft">
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid gap-x-10 gap-y-3 border-t border-border-soft py-8 md:grid-cols-[28px_minmax(0,7fr)_minmax(0,5fr)]">
              <span aria-hidden className="pt-1.5 font-mono text-[12px] text-paper-faint">{i + 1}</span>
              <div>
                <h3 className="font-display text-[22px] font-[650] leading-[1.2] text-paper [font-stretch:92%]">{step.title}</h3>
                <p className="mt-2 max-w-[60ch] text-[17px] leading-[1.6] text-paper-dim">{step.copy}</p>
              </div>
              <div className="min-w-0 md:pt-1.5">{step.proof}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n={4} label="Proof" id="proof-heading">
        <h2 id="proof-heading" className={`${RUN_IN} max-w-[36ch]`}>
          One real run, on the record.{" "}
          <span className={RUN_IN_REST}>
            Draft pull request #7 on our demo repository came out of a real, verified run.
          </span>
        </h2>
        <dl className="mt-10 max-w-[720px] border-b border-border-soft text-[16px]">
          {([
            ["Pull request", <a key="pr" href={DEMO_PR} target="_blank" rel="noreferrer" className="text-link min-h-0 font-mono text-[14px]">rahulp7801/opensrcer-demo#7&nbsp;<span aria-hidden className="text-[0.85em]">&#x2197;</span></a>],
            ["Tests", <span key="t" className="font-mono text-[14px] text-paper">fail without the fix, pass with it</span>],
            ["Disclosure", <span key="d" className="font-mono text-[14px] text-paper">an &quot;AI assistance&quot; section in the PR body</span>],
          ] as const).map(([term, value]) => (
            <div key={term} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border-soft py-3.5">
              <dt className="text-paper-muted">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section n={5} label="Start" id="start-heading">
        <h2 id="start-heading" className="font-display text-[clamp(40px,5vw,72px)] font-[700] leading-[1] tracking-[-0.02em] text-paper [font-stretch:88%]">
          Start with one issue.
        </h2>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={primary.href} className="btn-primary min-h-11 rounded-[10px] px-5 text-[15px] font-semibold">{primary.label}</Link>
          <Link href={secondary.href} className="text-link text-[16px]">{secondary.label}</Link>
        </div>
        <ul className="mt-16 grid gap-3 text-[16px] text-paper-muted sm:grid-cols-3 sm:gap-8">
          {FINE_PRINT.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </Section>
    </div>
  );
}

/** A numbered section: its label in a mono left rail, content on the right. */
function Section({ n, label, id, children }: { n: number; label: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-soft px-5 py-20 sm:px-8 sm:py-24">
      <div className="mx-auto grid max-w-[1320px] gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)]">
        <p className="font-mono text-[12px] text-paper-faint lg:pt-3">
          {n} — {label}
        </p>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function Dot({ tone }: { tone: "ok" | "alert" }) {
  return <span aria-hidden className={`mr-2 inline-block size-1.5 -translate-y-px rounded-full ${tone === "ok" ? "bg-ok" : "bg-alert"}`} />;
}

/** The hero: the claim (sentence case, one cobalt word, underlined by hand)
 *  beside the captioned code map. Shared with the private-preview page
 *  (components/preview-landing.tsx), which brings its own copy as children. */
export function HeroHeadline({ children }: { children?: React.ReactNode }) {
  return (
    <section className="px-5 pb-20 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
      <div className="mx-auto grid max-w-[1320px] items-center gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div>
          <p className="rise font-mono text-[12px] text-paper-faint">for your first open-source contribution</p>
          <h1 className="rise mt-5 max-w-[13ch] font-display text-[clamp(44px,6.2vw,84px)] font-[700] leading-[0.98] tracking-[-0.02em] text-paper [font-stretch:88%]" style={{ "--delay": "60ms" } as React.CSSProperties}>
            Issues in. Pull requests{" "}
            <span className="relative inline-block text-signal">
              out.
              {/* Annotates the word, under it, never over it. */}
              <Doodle doodle={underline} draw="load" delay={900} duration={600} stretch weight={0.5} className="absolute left-0 top-[96%] h-[0.16em] w-full" />
            </span>
          </h1>
          {children}
        </div>
        <figure className="mx-auto w-full max-w-[460px] lg:max-w-none">
          <figcaption className="font-mono text-[11.5px] leading-[1.6] tracking-[0.02em] text-paper-faint">
            <span className="fig-tag">fig. 1</span>a sketch · on the real Explore map of pallets/flask, 31 places depend on render_template()
          </figcaption>
          <CodeMap label="render_template()" className="mt-4 w-full" />
        </figure>
      </div>
    </section>
  );
}
