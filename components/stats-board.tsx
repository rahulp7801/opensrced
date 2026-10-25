"use client";

import { cn } from "@/lib/utils";
import { IconExternal } from "./icons";
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
        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-border-soft lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={cn("flex flex-col gap-2 bg-surface p-5", i === 5 && "col-span-2 lg:col-span-1")}>
              <div className="h-2.5 w-16 bg-surface-3 animate-pulse" />
              <div className="h-10 w-20 bg-surface-2 animate-pulse" />
              <div className="h-2 w-24 bg-surface-2 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-6 w-48 bg-surface-3 animate-pulse" />
          <div className="card p-6 space-y-3">
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
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-border-soft lg:grid-cols-5">
        <Counter label="runs" value={data.dispatches} tone="info" sub={data.dispatchWindow ? "recent runs" : "your history"} />
        <Counter label="patches" value={data.patchesGenerated} tone="signal" sub={`${Math.round((Number(data.successRate) || 0) * 100)}% success rate`} />
        <Counter label="PRs opened" value={data.prsCreated} tone="ok" sub={`${Math.round((Number(data.prRate) || 0) * 100)}% of runs`} />
        <Counter label="recorded spend" value={data.totalCostUsd} tone="signal" format="currency" sub="Anthropic API" />
        <Counter className="col-span-2 lg:col-span-1" label="scans" value={data.scans} tone="paper" sub={`${data.discoverRuns} via Discover`} />
      </div>

      <section>
        <div className="mb-4 sm:flex sm:items-baseline sm:justify-between sm:gap-6">
          <h2 className="display text-[32px] leading-none text-paper sm:text-[36px]">Biggest contributions</h2>
          <p className="mt-2 text-[14px] text-paper-muted sm:mt-0">Draft PRs on repositories with 1,000+ stars</p>
        </div>
        {data.biggestContributions.length === 0 ? (
          <div className="card px-6 py-10 sm:px-10">
            <div className="text-[18px] font-semibold text-paper">No pull requests on 1,000-star projects yet.</div>
            <p className="mt-2 max-w-xl text-[16px] leading-[1.6] text-paper-muted">
              When a run of yours opens a draft PR on a repository with more than 1,000 stars, it shows up here.
            </p>
            <a href="/issues" className="btn-primary mt-6">Find an issue →</a>
          </div>
        ) : (
          <ol className="card divide-y divide-border-soft overflow-hidden">
            {data.biggestContributions.map((c, i) => (
              <li key={c.dispatchId} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 px-5 py-4 transition hover:bg-ink-2 sm:px-6">
                <span className="display pt-0.5 text-right text-[26px] leading-none text-paper-muted num-tabular">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 text-[16px]">
                      <a href={c.prUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-medium text-paper hover:text-signal">
                        <span className="truncate">{c.repoFull}</span><IconExternal className="shrink-0" />
                      </a>
                      {c.issueNumber !== null && <span className="ml-1.5 text-paper-muted">fixes #{c.issueNumber}</span>}
                    </div>
                    <div className="shrink-0 text-[16px] font-semibold text-signal">★ {fmtStars(c.stars)}</div>
                  </div>
                  <div className="mt-0.5 text-[12px] text-paper-muted">
                    run <code className="font-mono text-paper-dim">{c.dispatchId.slice(-12)}</code>
                    {c.startedAt && (
                      <>
                        <span className="mx-1.5 text-paper-faint">·</span>
                        {new Date(c.startedAt).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-[32px] leading-none text-paper sm:text-[36px]">Recent activity</h2>
          <span className="text-[14px] text-paper-muted">Latest 20</span>
        </div>
        {data.recentActivity.length === 0 ? (
          <div className="card px-6 py-8 text-[16px] text-paper-muted">
            Nothing yet. Run a scan or start a run.
          </div>
        ) : (
          <ul className="card divide-y divide-border-soft overflow-hidden text-[15px]">
            {data.recentActivity.map((a, i) => (
              <li key={i} className="grid grid-cols-[96px_1fr] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[96px_90px_minmax(0,1fr)] sm:px-6">
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
                          <a href={a.prUrl} target="_blank" rel="noreferrer" className="text-signal underline decoration-signal/60 underline-offset-2 hover:decoration-signal">
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
  tone,
  sub,
  format,
  className,
}: {
  label: string;
  value: number;
  tone: "paper" | "ok" | "signal" | "info";
  sub?: string;
  format?: "currency";
  className?: string;
}) {
  // Color marks the metric's kind with a small dot; the numeral stays cream.
  const dot = {
    paper: "bg-paper-muted",
    ok: "bg-ok",
    signal: "bg-signal",
    info: "bg-info",
  }[tone];
  const n = Number.isFinite(value) ? value : 0;
  const display = format === "currency" ? `$${n.toFixed(2)}` : String(n);
  // Long figures step down a size rather than being clipped by the tile ("$14.82" is 6 characters).
  const size = display.length <= 4 ? "text-[52px]" : display.length <= 7 ? "text-[38px]" : "text-[28px]";
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-2 bg-surface p-6", className)}>
      <div className="kicker flex items-center gap-2 text-paper-muted"><span aria-hidden className={cn("size-1.5 rounded-full", dot)} />{label}</div>
      <div className={cn("display num-tabular break-all leading-[0.9] text-paper", size)}>{display}</div>

      {sub && <div className="mt-1 text-[13px] text-paper-dim">{sub}</div>}
    </div>
  );
}

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
