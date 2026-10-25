"use client";

import { cn } from "@/lib/utils";
import { useSwrFetch } from "@/lib/use-swr-fetch";

type Contribution = {
  prUrl: string;
  repoFull: string;
  stars: number;
  issueNumber: number | null;
  dispatchId: string;
  startedAt: string | null;
};

type ActivityItem = {
  kind: "scan" | "discover" | "dispatch";
  ts: string;
  repo?: string;
  issueNumber?: number;
  prUrl?: string;
};

type StatsData = {
  dispatchWindow: number | null;
  scans: number;
  discoverRuns: number;
  dispatches: number;
  prsCreated: number;
  bugsSquashed: number;
  totalCostUsd: number;
  patchesGenerated: number;
  successRate: number;
  prRate: number;
  biggestContributions: Contribution[];
  recentActivity: ActivityItem[];
};

export function StatsBoard() {
  const { data, error: err, isLoading: loading } = useSwrFetch<StatsData>(
    "/api/activity",
    { refreshInterval: 60_000 },
  );

  if (loading && !data) {
    return (
      <div className="space-y-10">
        <div className="grid grid-cols-2 border-y border-border-soft lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={cn("flex flex-col gap-2", "min-w-0 border-border-soft py-5 max-lg:border-b max-lg:odd:pr-4 max-lg:even:border-l max-lg:even:pl-4 max-lg:last:col-span-2 max-lg:last:border-b-0 max-lg:last:border-l-0 max-lg:last:pl-0 lg:px-6 lg:first:pl-0 lg:not-first:border-l")}>
              <div className="h-2.5 w-16 bg-surface-3 animate-pulse" />
              <div className="h-10 w-20 bg-surface-2 animate-pulse" />
              <div className="h-2 w-24 bg-surface-2 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-6 w-48 bg-surface-3 animate-pulse" />
          <div className="space-y-3 border-y border-border-soft py-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4">
                <div className="h-4 w-8 bg-surface-2 animate-pulse" />
                <div className="h-4 flex-1 bg-surface-2 animate-pulse" />
                <div className="h-4 w-12 bg-surface-2 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (err && !data) {
    // ponytail: the hook polls every minute on its own; the button just reloads now.
    return (
      <div role="alert" className="callout callout-alert flex flex-wrap items-center justify-between gap-3 p-4 text-[13px] text-alert">
        <span>Your activity couldn&apos;t load right now. It tries again every minute. <span className="text-alert/80">({err})</span></span>
        <button type="button" onClick={() => window.location.reload()} className="btn-quiet text-alert" data-size="sm">Try again</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-10">
      {err && <p role="status" className="callout callout-alert px-3 py-2 text-[13px] text-alert">Could not refresh activity. Showing the last loaded data.</p>}
      {data.dispatchWindow && <p className="text-[13px] text-paper-muted">Run, patch, PR, and spend figures cover your latest {data.dispatchWindow} runs. Scan counts cover your recorded history.</p>}
      {/* One ruled strip: five columns split by hairlines, no tiles. */}
      <div className="grid grid-cols-2 border-y border-border-soft lg:grid-cols-5">
        <Counter label="runs" value={data.dispatches} sub={data.dispatchWindow ? "recent runs" : "your history"} />
        <Counter label="patches" value={data.patchesGenerated} sub={`${Math.round((Number(data.successRate) || 0) * 100)}% success rate`} />
        <Counter label="PRs opened" value={data.prsCreated} sub={`${Math.round((Number(data.prRate) || 0) * 100)}% of runs`} />
        <Counter label="recorded spend" value={data.totalCostUsd} format="currency" sub="Anthropic API" />
        <Counter label="scans" value={data.scans} sub={`${data.discoverRuns} via Discover`} />
      </div>

      <section>
        <div className="mb-4 sm:flex sm:items-baseline sm:justify-between sm:gap-6">
          <h2 className="display text-[28px] leading-none text-paper sm:text-[32px]">Biggest contributions</h2>
          <p className="mt-2 text-[14px] text-paper-muted sm:mt-0">Draft PRs on repositories with 1,000+ stars</p>
        </div>
        {data.biggestContributions.length === 0 ? (
          <div className="border-y border-border-soft py-8">
            <p className="max-w-2xl font-display text-[20px] leading-[1.35] text-paper" style={{ fontWeight: 650 }}>
              No pull requests on 1,000-star projects yet.{" "}
              <span className="font-sans font-normal text-paper-muted">When a run of yours opens a draft PR on a repository with more than 1,000 stars, it shows up here.</span>
            </p>
            <a href="/issues" className="btn-primary mt-6">Find an issue</a>
          </div>
        ) : (
          // Ruled rows; the rank hangs in the left margin in mono.
          <ol className="ruled">
            {data.biggestContributions.map((c, i) => (
              <li key={c.dispatchId} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-[18px]">
                <span className="pt-1 font-mono text-[12px] text-paper-faint num-tabular">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 text-[16px]">
                      <a href={c.prUrl} target="_blank" rel="noreferrer" className="text-link min-h-0 p-0 font-semibold">
                        {c.repoFull}
                      </a>
                      {c.issueNumber !== null && <span className="ml-2 text-paper-muted">fixes #{c.issueNumber}</span>}
                    </div>
                    <div className="shrink-0 font-mono text-[13px] text-paper-dim">★ {fmtStars(c.stars)}</div>
                  </div>
                  <p className="meta mt-1">
                    <span>run {c.dispatchId.slice(-12)}</span>
                    {c.startedAt && <span>{new Date(c.startedAt).toLocaleDateString()}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-[28px] leading-none text-paper sm:text-[32px]">Recent activity</h2>
          <span className="text-[14px] text-paper-muted">Latest 20</span>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="border-y border-border-soft py-6 text-[16px] text-paper-muted">
            Nothing yet. Scans and runs you start show up here.
          </p>
        ) : (
          <ul className="ruled text-[15px]">
            {data.recentActivity.map((a, i) => (
              <li key={i} className="grid grid-cols-[96px_1fr] items-center gap-x-4 gap-y-1.5 py-3.5 sm:grid-cols-[96px_90px_minmax(0,1fr)]">
                <ActivityKindChip kind={a.kind} />
                <span className="justify-self-end text-[12px] text-paper-muted tabular-nums sm:justify-self-start">
                  {fmtRelative(a.ts, Date.now())}
                </span>
                <span className="col-span-2 min-w-0 text-paper sm:col-span-1 sm:truncate">
                  {a.kind === "dispatch" ? (
                    <>
                      run on <span className="text-paper-muted">{a.repo ?? "—"}</span>
                      {a.issueNumber !== undefined && (
                        <span className="text-paper-faint"> #{a.issueNumber}</span>
                      )}
                      {a.prUrl && (
                        <>
                          {" · "}
                          <a href={a.prUrl} target="_blank" rel="noreferrer" className="text-link min-h-0 p-0">
                            PR opened
                          </a>
                        </>
                      )}
                    </>
                  ) : a.kind === "scan" ? (
                    <>
                      scan {a.repo ? <span className="text-paper-muted">{a.repo}</span> : <em className="text-paper-faint">repo unknown</em>}
                    </>
                  ) : (
                    <>discover search run</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Counter({
  label,
  value,
  sub,
  format,
}: {
  label: string;
  value: number;
  sub?: string;
  format?: "currency";
}) {
  const n = Number.isFinite(value) ? value : 0;
  const display = format === "currency" ? `$${n.toFixed(2)}` : String(n);
  // Long figures step down a size rather than overflowing the column.
  const size = display.length <= 5 ? "text-[44px]" : display.length <= 8 ? "text-[34px]" : "text-[26px]";
  // Money shows its cents small and raised ($3.42), like a price tag.
  const [whole, cents] = format === "currency" ? display.split(".") : [display, undefined];
  return (
    <div className={STRIP_CELL_CLASS}>
      <div className={cn("display num-tabular break-all leading-none text-paper", size)} style={{ fontWeight: 650 }}>
        {whole}{cents !== undefined && <span className="align-[0.5em] text-[0.6em]">.{cents}</span>}
      </div>
      <div className="mt-2 text-[14px] text-paper-muted">{label.charAt(0).toUpperCase() + label.slice(1)}</div>
      {sub && <div className="mt-0.5 font-mono text-[12px] text-paper-faint">{sub}</div>}
    </div>
  );
}

/** A strip column: hairlines between columns (and rows, on phones). */
const STRIP_CELL_CLASS = "min-w-0 border-border-soft py-5 max-lg:border-b max-lg:odd:pr-4 max-lg:even:border-l max-lg:even:pl-4 max-lg:last:col-span-2 max-lg:last:border-b-0 max-lg:last:border-l-0 max-lg:last:pl-0 lg:px-6 lg:first:pl-0 lg:not-first:border-l";

function ActivityKindChip({ kind }: { kind: "scan" | "discover" | "dispatch" }) {
  const cfg: Record<
    "scan" | "discover" | "dispatch",
    { label: string; cls: string }
  > = {
    scan:     { label: "scan",     cls: "" },
    discover: { label: "discover", cls: "info" },
    dispatch: { label: "run", cls: "signal" },
  };
  const c = cfg[kind] ?? cfg.scan; // a kind added on the server later must not break the page
  return (
    <span className="tag w-[88px] justify-start" data-tone={c.cls || undefined}>
      {c.label}
    </span>
  );
}

function fmtStars(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtRelative(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diffMs = Math.max(0, now - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
