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
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={cn("flex flex-col gap-2 bg-ink p-5", i === 5 && "col-span-2 lg:col-span-1")}>
              <div className="h-2.5 w-16 bg-surface-3 animate-pulse" />
              <div className="h-10 w-20 bg-surface-2 animate-pulse" />
              <div className="h-2 w-24 bg-surface-2 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-6 w-48 bg-surface-3 animate-pulse" />
          <div className="border border-border bg-surface/40 p-6 space-y-3">
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
  if (err) {
    return <div className="border border-alert/40 bg-alert/5 p-3 text-[12px] text-alert">{err}</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-10">
      {data.dispatchWindow && <p className="text-[12px] text-paper-muted">Run, patch, PR, and spend figures cover your latest {data.dispatchWindow} runs. Scan counts cover your recorded history.</p>}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-5">
        <Counter label="runs" value={data.dispatches} tone="info" sub={data.dispatchWindow ? "recent runs" : "your history"} />
        <Counter label="patches" value={data.patchesGenerated} tone="signal" sub={`${Math.round(data.successRate * 100)}% success rate`} />
        <Counter label="PRs opened" value={data.prsCreated} tone="ok" sub={`${Math.round(data.prRate * 100)}% of runs`} />
        <Counter label="recorded spend" value={data.totalCostUsd} tone="signal" format="currency" sub="Anthropic API" />
        <Counter className="col-span-2 lg:col-span-1" label="scans" value={data.scans} tone="paper" sub={`${data.discoverRuns} via Discover`} />
      </div>

      <section>
        <div className="mb-4 sm:flex sm:items-baseline sm:justify-between sm:gap-6">
          <h2 className="text-xl font-medium tracking-tight text-paper">Biggest contributions</h2>
          <p className="mt-1 text-xs text-paper-muted sm:mt-0">Draft PRs on repositories with 1,000+ stars</p>
        </div>
        {data.biggestContributions.length === 0 ? (
          <div className="border border-border bg-surface/40 p-8 text-center">
            <div className="text-[13px] text-paper">No 1k★ PRs yet.</div>
            <p className="mt-2 text-[11.5px] text-paper-muted leading-snug">
              Open a draft PR on a repo with more than 1000 stars from an opensrcer run —
              it&apos;ll show up here automatically. Public star counts are fetched from GitHub and
              cached.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border-soft overflow-hidden rounded-md border border-border bg-surface/40">
            {data.biggestContributions.map((c, i) => (
              <li key={c.dispatchId} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 transition hover:bg-surface-2/60">
                <span className="pt-1 text-right text-lg leading-none text-paper-muted num-tabular">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 text-sm">
                      <a href={c.prUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-medium text-paper hover:text-signal">
                        <span className="truncate">{c.repoFull}</span><IconExternal className="shrink-0" />
                      </a>
                      {c.issueNumber !== null && <span className="ml-1.5 text-paper-muted">fixes #{c.issueNumber}</span>}
                    </div>
                    <div className="shrink-0 text-base font-medium text-signal">★ {fmtStars(c.stars)}</div>
                  </div>
                  <div className="mt-0.5 text-[11px] text-paper-muted">
                    run <code className="text-paper-faint">{c.dispatchId.slice(-12)}</code>
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
          <h2 className="text-xl font-medium tracking-tight text-paper">Recent activity</h2>
          <span className="text-xs text-paper-muted">Latest 20</span>
        </div>
        {data.recentActivity.length === 0 ? (
          <div className="border border-border bg-surface/40 p-6 text-center text-[12px] text-paper-muted">
            Nothing yet. Run a scan or start a run.
          </div>
        ) : (
          <ul className="divide-y divide-border-soft overflow-hidden rounded-md border border-border bg-surface/40 text-[12.5px]">
            {data.recentActivity.map((a, i) => (
              <li key={i} className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[72px_90px_minmax(0,1fr)]">
                <ActivityKindChip kind={a.kind} />
                <span className="justify-self-end text-[11px] text-paper-muted tabular-nums sm:justify-self-start">
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
  const color = {
    paper: "text-paper",
    ok: "text-ok",
    signal: "text-signal",
    info: "text-info",
  }[tone];
  const display = format === "currency" ? `$${value.toFixed(2)}` : String(value);
  return (
    <div className={cn("relative flex flex-col gap-1.5 bg-ink p-5 transition hover:bg-surface-2/40", className)}>
      <div className="mono-label text-paper-muted">{label}</div>
      <div className={cn("text-[36px] font-medium leading-none num-tabular", color)}>{display}</div>
      {sub && <div className="text-[11px] text-paper-dim mt-1">{sub}</div>}
    </div>
  );
}

function ActivityKindChip({ kind }: { kind: "scan" | "discover" | "dispatch" }) {
  const cfg: Record<
    "scan" | "discover" | "dispatch",
    { label: string; cls: string }
  > = {
    scan:     { label: "scan",     cls: "border-border-soft bg-surface text-paper-dim" },
    discover: { label: "discover", cls: "border-info/40 bg-info/10 text-info" },
    dispatch: { label: "run", cls: "border-signal/40 bg-signal/10 text-signal" },
  };
  const c = cfg[kind];
  return (
    <span className={cn("inline-block text-[11px] uppercase tracking-[0.12em] border px-1.5 py-0.5 leading-none w-[72px] text-center", c.cls)}>
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
