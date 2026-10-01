import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "@phosphor-icons/react/dist/ssr";

// An illustrative run, printed like a ledger: what the agent did, in order,
// with the evidence it produced. Not live data.
const RUN_STEPS = [
  ["Explore", "14 files read"],
  ["Diagnose", "root cause in query.ts"],
  ["Patch", "+12 −3, one file"],
  ["Review", "checks passed"],
] as const;

const GUARDRAILS = [
  "Read-only repository tools while the agent explores",
  "A hard spend limit on every run",
  "Draft pull requests only, never a direct merge",
] as const;

const WORKFLOW = [
  ["Find", "Search public projects by language and activity, or bring an issue you already care about."],
  ["Understand", "Map the repository, trace callers, and see why the change belongs where it does."],
  ["Ship", "Read the diff and the verification record, then open a draft pull request in your name."],
] as const;

export default function LandingPage() {
  const localMode = process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
  const primary = localMode
    ? { href: "/discover", label: "Browse repositories" }
    : { href: "/demo", label: "See a complete run" };
  const secondary = localMode
    ? { href: "/demo", label: "Explore the demo" }
    : { href: "/login", label: "Connect GitHub" };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-8">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="grid min-h-[calc(100svh-65px)] items-center gap-14 py-16 lg:grid-cols-12 lg:gap-10 lg:py-20">
        <div className="lg:col-span-7">
          <p className="eyebrow reveal">Open-source work, with context</p>
          <h1 className="display reveal mt-7 text-[52px] leading-[0.98] text-paper sm:text-[76px] lg:text-[88px]" style={{ "--d": "80ms" } as React.CSSProperties}>
            Turn open issues into <span className="text-signal">reviewable</span> pull&nbsp;requests.
          </h1>
          <p className="reveal mt-8 max-w-xl text-[17px] leading-8 text-paper-dim" style={{ "--d": "160ms" } as React.CSSProperties}>
            Find an issue worth fixing, understand the code around it, and read every line of the proposed patch before anything reaches GitHub.
          </p>
          <div className="reveal mt-10 flex flex-wrap items-center gap-x-7 gap-y-4" style={{ "--d": "240ms" } as React.CSSProperties}>
            <Link
              href={primary.href}
              className="group inline-flex min-h-12 items-center gap-2.5 rounded-full bg-signal px-6 text-[15px] font-semibold text-ink shadow-[0_10px_40px_-12px_rgb(255_107_61/0.7)] transition hover:-translate-y-0.5 hover:bg-signal-soft"
            >
              {primary.label}
              <ArrowRight aria-hidden size={17} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={secondary.href}
              className="inline-flex min-h-12 items-center gap-1.5 border-b border-border-strong text-[15px] text-paper-dim transition hover:border-paper hover:text-paper"
            >
              {secondary.label}
              <ArrowUpRight aria-hidden size={15} />
            </Link>
          </div>
          <ul className="reveal mt-12 space-y-3 border-t border-border-soft pt-6" style={{ "--d": "320ms" } as React.CSSProperties}>
            {GUARDRAILS.map((item, index) => (
              <li key={item} className="flex items-baseline gap-4 text-[14px] text-paper-dim">
                <span className="font-mono text-[11px] text-signal">{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* The ledger */}
        <article
          aria-label="Illustrative agent run"
          className="reveal relative lg:col-span-5"
          style={{ "--d": "200ms" } as React.CSSProperties}
        >
          <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] bg-[radial-gradient(closest-side,rgb(255_107_61/0.12),transparent)] blur-2xl" />
          <div className="relative overflow-hidden rounded-[14px] border border-border bg-surface shadow-[0_40px_80px_-40px_rgb(0_0_0/0.9)]">
            <div className="flex items-center justify-between gap-4 border-b border-dashed border-border px-6 py-4 font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted">
              <span>Run ledger</span>
              <span className="text-paper-dim normal-case tracking-normal">acme/search #184</span>
            </div>
            <div className="px-6 pt-6 pb-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-faint">Issue</p>
              <h2 className="display mt-2 text-[30px] leading-[1.08] text-paper">Handle an empty search query</h2>
              <p className="mt-2 text-[14px] leading-6 text-paper-dim">Return early for blank input without changing valid search behavior.</p>
            </div>
            <ol className="px-6 py-5">
              {RUN_STEPS.map(([label, evidence], index) => (
                <li
                  key={label}
                  className="reveal flex items-baseline gap-3 py-2.5 text-[14px]"
                  style={{ "--d": `${420 + index * 110}ms` } as React.CSSProperties}
                >
                  <span className="w-6 font-mono text-[11px] text-paper-faint">{String(index + 1).padStart(2, "0")}</span>
                  <span className="font-medium text-paper">{label}</span>
                  <span aria-hidden className="leader" />
                  <span className="font-mono text-[12px] text-paper-dim">{evidence}</span>
                  <Check aria-label="Complete" weight="bold" size={14} className="shrink-0 self-center text-ok" />
                </li>
              ))}
            </ol>
            <div className="relative flex items-center justify-between gap-4 border-t border-dashed border-border px-6 py-5">
              <div>
                <p className="text-[14px] font-medium text-paper">Draft pull request</p>
                <p className="mt-0.5 text-[12px] text-paper-muted">Opened in your name, for your review.</p>
              </div>
              <span
                className="stamp-in inline-block rounded-md border-2 border-signal px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-signal"
                style={{ "--d": "950ms" } as React.CSSProperties}
              >
                Ready
              </span>
            </div>
          </div>
        </article>
      </section>

      {/* ── Workflow ─────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 lg:py-28" aria-labelledby="workflow-heading">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="eyebrow">The workflow</p>
            <h2 id="workflow-heading" className="display mt-6 text-[40px] leading-[1.04] text-paper sm:text-[48px]">
              Keep the issue, the evidence, and the patch together.
            </h2>
          </div>
          <ol className="grid gap-10 sm:grid-cols-3 sm:gap-8 lg:col-span-8">
            {WORKFLOW.map(([title, description], index) => (
              <li key={title} className="group">
                <span
                  aria-hidden
                  className="display block text-[88px] leading-none text-transparent transition-colors duration-500 [-webkit-text-stroke:1px_var(--color-border-strong)] group-hover:[-webkit-text-stroke:1px_var(--color-signal)]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-5 text-[18px] font-semibold text-paper">{title}</h3>
                <p className="mt-2 text-[14px] leading-6 text-paper-dim">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Trust ────────────────────────────────────────────────────── */}
      <section className="grid gap-10 border-t border-border py-20 md:grid-cols-2 md:gap-16" aria-labelledby="trust-heading">
        <div className="border-l-2 border-signal pl-6">
          <h2 id="trust-heading" className="display text-[30px] leading-[1.1] text-paper">Know what the agent inspected.</h2>
          <p className="mt-4 text-[15px] leading-7 text-paper-dim">
            Every run keeps its repository reads, the diagnosis, the generated diff, and its provider cost, instead of hiding the work behind a spinner.
          </p>
        </div>
        <div className="border-l-2 border-border-strong pl-6">
          <h2 className="display text-[30px] leading-[1.1] text-paper">You keep the final decision.</h2>
          <p className="mt-4 text-[15px] leading-7 text-paper-dim">
            Your provider key stays encrypted, repository tools are read-only during analysis, and nothing merges without your review.
          </p>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────── */}
      <section className="mb-4 flex flex-col items-start justify-between gap-8 rounded-[14px] border border-border bg-surface/60 px-8 py-12 sm:flex-row sm:items-center sm:px-12">
        <h2 className="display max-w-xl text-[34px] leading-[1.05] text-paper sm:text-[42px]">
          Pick an issue. Read the code. <span className="text-signal">Ship the patch.</span>
        </h2>
        <Link
          href={primary.href}
          className="group inline-flex min-h-12 shrink-0 items-center gap-2.5 rounded-full bg-paper px-6 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-paper-2"
        >
          {primary.label}
          <ArrowRight aria-hidden size={17} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>
    </div>
  );
}
