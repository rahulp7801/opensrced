import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  GitBranch,
  MagnifyingGlass,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";

const RUN_STEPS = [
  ["Explore", "Read the files, symbols, and call sites tied to the issue."],
  ["Diagnose", "Explain the root cause with links back to the relevant code."],
  ["Patch", "Prepare the smallest change that addresses the issue."],
  ["Review", "Check the diff before a draft pull request is opened."],
] as const;

const GUARDRAILS = [
  "Read-only repository exploration",
  "A spend limit on every agent run",
  "Draft pull requests for human review",
] as const;

export default function LandingPage() {
  const localMode = process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8">
      <section className="grid min-h-[calc(100svh-65px)] gap-14 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:py-20">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-signal">Open-source work, with context</p>
          <h1 className="mt-6 text-[45px] font-semibold leading-[0.98] tracking-[-0.06em] text-balance sm:text-[64px]">
            Turn open issues into reviewable pull requests.
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-paper-dim sm:text-[17px]">
            Find a useful issue, understand the code around it, and inspect the proposed fix before anything reaches GitHub.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href={localMode ? "/discover" : "/demo"} className="inline-flex min-h-12 items-center gap-2 rounded-md bg-paper px-5 text-sm font-semibold text-ink transition hover:-translate-y-px hover:bg-paper-2">
              {localMode ? "Browse repositories" : "See a complete run"}
              <ArrowRight aria-hidden size={17} weight="bold" />
            </Link>
            <Link href={localMode ? "/demo" : "/login"} className="inline-flex min-h-12 items-center gap-2 text-sm font-medium text-paper-dim transition hover:text-paper">
              {localMode ? "Explore the demo" : "Connect GitHub"}
              <ArrowUpRight aria-hidden size={16} />
            </Link>
          </div>
          <ul className="mt-9 grid gap-3 text-sm text-paper-muted sm:grid-cols-3">
            {GUARDRAILS.map((item) => (
              <li key={item} className="flex items-start gap-2 border-t border-border pt-3 leading-5">
                <CheckCircle aria-hidden className="mt-0.5 shrink-0 text-ok" size={16} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <article className="min-w-0 overflow-hidden rounded-md border border-border bg-surface" aria-label="Illustrative agent run">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 text-xs text-paper-muted">
            <span>Example run</span>
            <span className="font-mono">acme/search #184</span>
          </div>
          <div className="px-5 py-5 sm:px-6">
            <p className="text-xs text-paper-muted">Issue</p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.02em]">Handle an empty search query</h2>
            <p className="mt-2 text-sm leading-6 text-paper-dim">Return early for blank input without changing valid search behavior.</p>
          </div>
          <ol className="border-t border-border">
            {RUN_STEPS.map(([label, description], index) => (
              <li key={label} className="grid grid-cols-[28px_1fr_auto] gap-3 border-b border-border-soft px-5 py-4 last:border-b-0 sm:px-6">
                <span className="pt-0.5 font-mono text-xs text-paper-faint">0{index + 1}</span>
                <div>
                  <h3 className="text-sm font-medium text-paper">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-paper-muted">{description}</p>
                </div>
                <CheckCircle aria-label="Complete" className="mt-0.5 text-ok" size={17} />
              </li>
            ))}
          </ol>
          <div className="flex items-start gap-3 border-t border-ok/30 bg-ok/5 px-5 py-4 sm:px-6">
            <GitBranch aria-hidden className="mt-0.5 shrink-0 text-ok" size={18} />
            <div>
              <p className="text-sm font-medium text-paper">Draft pull request ready for review</p>
              <p className="mt-1 text-xs leading-5 text-paper-muted">The patch stays reviewable. Target-repository tests run in your own CI.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="border-t border-border py-16 lg:py-20" aria-labelledby="workflow-heading">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-paper-muted">The workflow</p>
            <h2 id="workflow-heading" className="mt-4 max-w-md text-4xl font-medium leading-[1.05] tracking-[-0.045em]">
              Keep the issue, evidence, and patch together.
            </h2>
          </div>
          <ol className="grid sm:grid-cols-3">
            {[
              ["Find", "Search public projects or bring an issue you already care about."],
              ["Understand", "Explore the repository and see why the change belongs where it does."],
              ["Ship", "Review the diff and verification record before opening a draft."],
            ].map(([title, description], index) => (
              <li key={title} className="border-t border-border py-5 sm:px-5 sm:first:pl-0 sm:not-first:border-l sm:last:pr-0">
                <span className="font-mono text-xs text-paper-faint">0{index + 1}</span>
                <h3 className="mt-6 text-base font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-paper-dim">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mb-4 grid gap-8 border-y border-border py-10 md:grid-cols-2 md:gap-16" aria-labelledby="trust-heading">
        <div className="flex gap-4">
          <MagnifyingGlass aria-hidden className="mt-1 shrink-0 text-signal" size={20} />
          <div>
            <h2 id="trust-heading" className="text-lg font-medium tracking-tight">Know what the agent inspected</h2>
            <p className="mt-3 text-sm leading-6 text-paper-dim">Runs expose repository reads, the diagnosis, the generated diff, and provider cost instead of hiding the process behind a spinner.</p>
          </div>
        </div>
        <div className="flex gap-4">
          <ShieldCheck aria-hidden className="mt-1 shrink-0 text-signal" size={20} />
          <div>
            <h2 className="text-lg font-medium tracking-tight">You keep the final decision</h2>
            <p className="mt-3 text-sm leading-6 text-paper-dim">Your provider key stays encrypted, repository tools are read-only during analysis, and generated changes require review before merge.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
