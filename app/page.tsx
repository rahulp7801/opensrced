import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
      <section className="grid gap-12 py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16 lg:py-24">
        <div>
          <p className="mb-6 text-sm font-medium text-signal">From open issue to reviewed patch</p>
          <h1 className="max-w-xl text-[44px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-[58px]">Make your next<br className="hidden sm:block" /> contribution count.</h1>
          <p className="mt-6 max-w-md text-base leading-7 text-paper-dim">Find an issue worth fixing. Explore the code with AI, generate a patch, and review the changes before you publish.</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/demo" className="inline-flex min-h-12 items-center gap-3 rounded-md bg-signal px-5 font-medium text-ink transition hover:bg-signal-soft">Explore the demo <span aria-hidden="true">&rarr;</span></Link>
            <Link href="/login" className="inline-flex min-h-12 items-center px-2 text-paper-dim hover:text-paper">Connect GitHub <span aria-hidden="true" className="ml-2">&#8599;</span></Link>
          </div>
          <p className="mt-4 text-xs text-paper-muted">The interactive demo needs no account or API key.</p>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 text-xs text-paper-muted"><span>Patch review</span><span>Illustrative preview</span></div>
          <div className="p-5 sm:p-6">
            <p className="text-xs text-paper-muted">Issue / Input validation</p>
            <h2 className="mt-2 text-xl font-medium tracking-tight">Handle an empty search query</h2>
            <p className="mt-3 text-sm leading-6 text-paper-dim">Return an empty result before querying the database. Keep the existing search behavior for valid input.</p>
          </div>
          <div className="border-y border-border bg-ink-2">
            <div className="px-5 py-3 font-mono text-xs text-paper-muted">src/search.ts</div>
            <pre className="overflow-x-auto pb-4 text-xs leading-7"><code><span className="block px-5 text-paper-dim">{'  async function search(query: string) {'}</span><span className="block bg-ok/10 px-5 text-ok">{'+   if (!query.trim()) return [];'} </span><span className="block px-5 text-paper-dim">{'    return database.search(query);'}</span><span className="block px-5 text-paper-dim">{'  }'}</span></code></pre>
          </div>
          <div className="flex items-start gap-3 p-5 sm:p-6"><span className="mt-0.5 text-signal" aria-hidden="true">&bull;</span><div><p className="text-sm font-medium">Your review comes next</p><p className="mt-1 text-xs leading-5 text-paper-muted">Inspect the diff and check results. Run your repository tests before merging.</p></div></div>
        </div>
      </section>

      <section className="grid gap-8 border-t border-border py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:py-16" aria-labelledby="workflow-heading">
        <div><p className="text-sm text-paper-muted">The workflow</p><h2 id="workflow-heading" className="mt-3 max-w-sm text-3xl font-medium leading-tight tracking-[-0.03em]">Less searching.<br />More understanding.</h2><p className="mt-4 max-w-sm text-sm leading-6 text-paper-dim">Keep the issue, the implementation, and the review in one place.</p></div>
        <ol className="divide-y divide-border">
          {[
            ["Find a place to start", "Browse repositories and open issues, or bring a specific issue you want to work on."],
            ["Understand the change", "Ask questions about the codebase, then generate a patch with a budget you control."],
            ["Review before you publish", "Read the diff and see which checks ran. Preview a fix or open a draft pull request for review."],
          ].map(([title, description], index) => <li key={title} className="flex gap-5 py-5 first:pt-0 last:pb-0"><span className="pt-1 font-mono text-xs text-paper-muted">0{index + 1}</span><div><h3 className="text-base font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-paper-dim">{description}</p></div></li>)}
        </ol>
      </section>

      <section className="mb-4 grid gap-6 rounded-lg border border-border bg-surface px-6 py-8 sm:px-8 md:grid-cols-2 md:gap-12" aria-labelledby="before-heading">
        <div><h2 id="before-heading" className="text-lg font-medium tracking-tight">Before your first live run</h2><p className="mt-3 text-sm leading-6 text-paper-dim">Connect GitHub and add your own provider API key in Settings. AI usage is billed by your provider; run budgets apply to the Claude agent.</p></div>
        <div><h3 className="text-lg font-medium tracking-tight">A patch is a starting point</h3><p className="mt-3 text-sm leading-6 text-paper-dim">AI-generated changes need review. Target-repository tests do not run in hosted jobs, so validate the patch in your own environment before merging.</p></div>
      </section>
    </div>
  );
}
