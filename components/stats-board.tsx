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
    { refreshInterval: 15_000 },
  );

  if (loading && !data) {
    return (
      <div className="space-y-10">
        <div className="grid grid-cols-2 lg:grid-cols-5 border-t border-b border-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-2 p-5 border-l border-border first:border-l-0">
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
      {/* Big counter strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 border-t border-b border-border">
        <Counter label="dispatches" value={data.dispatches} tone="info" sub="all time" />
        <Counter label="patches" value={data.patchesGenerated} tone="signal" sub={`${Math.round(data.successRate * 100)}% success rate`} />
        <Counter label="PRs opened" value={data.prsCreated} tone="ok" sub={`${Math.round(data.prRate * 100)}% of dispatches`} />
        <Counter label="total spend" value={data.totalCostUsd} tone="signal" format="currency" sub="Anthropic API" />
        <Counter label="scans" value={data.scans} tone="paper" sub={`${data.discoverRuns} via Discover`} />
      </div>

      {/* Biggest contributions */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="serif text-[26px] text-paper">Biggest contributions</h2>
          <span className="mono-label text-paper-muted">PRs opened on repos ★ ≥ 1000</span>
        </div>
        {data.biggestContributions.length === 0 ? (
          <div className="border border-border bg-surface/40 p-8 text-center">
            <div className="text-[13px] text-paper">No 1k★ PRs yet.</div>
            <p className="mt-2 text-[11.5px] text-paper-muted leading-snug">
              Open a draft PR on a repo with more than 1000 stars via the agentic or solve pipeline —
              it&apos;ll show up here automatically. Stars are fetched live via <code>gh api</code> and
              cached for a week.
            </p>
          </div>
        ) : (
          <ol className="border border-border bg-surface/40 divide-y divide-border-soft">
            {data.biggestContributions.map((c, i) => (
              <li key={c.dispatchId} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60 transition">
                <span className="serif text-[24px] leading-none text-paper-muted w-8 text-right shrink-0 num-tabular">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={c.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[14px] text-paper hover:text-signal truncate inline-flex items-center gap-1.5"
                  >
                    {c.repoFull}
                    {c.issueNumber !== null && (
                      <span className="text-paper-faint">
                        · fixes #{c.issueNumber}
                      </span>
                    )}
                    <IconExternal />
                  </a>
                  <div className="mt-0.5 text-[11px] text-paper-muted">
                    dispatch <code className="text-paper-faint">{c.dispatchId.slice(-12)}</code>
                    {c.startedAt && (
                      <>
                        <span className="mx-1.5 text-paper-faint">·</span>
                        {new Date(c.startedAt).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5 text-signal">
                  <span className="text-[13px]">★</span>
                  <span className="serif text-[22px] leading-none num-tabular">
                    {fmtStars(c.stars)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Recent activity feed */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="serif text-[26px] text-paper">Recent activity</h2>
          <span className="mono-label text-paper-muted">last 20</span>
        </div>
        {data.recentActivity.length === 0 ? (
          <div className="border border-border bg-surface/40 p-6 text-center text-[12px] text-paper-muted">
            Nothing yet. Run a scan or fire a dispatch.
          </div>
        ) : (
          <ul className="border border-border bg-surface/40 divide-y divide-border-soft text-[12.5px]">
            {data.recentActivity.map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                <ActivityKindChip kind={a.kind} />
                <span className="text-paper-muted w-24 shrink-0 tabular-nums text-[11px]">
                  {fmtRelative(a.ts, Date.now())}
                </span>
                <span className="flex-1 text-paper truncate">
                  {a.kind === "dispatch" ? (
                    <>
                      dispatch on <span className="text-paper-muted">{a.repo ?? "—"}</span>
                      {a.issueNumber !== undefined && (
                        <span className="text-paper-faint"> #{a.issueNumber}</span>
                      )}
                      {a.prUrl && (
                        <>
                          {" · "}
                          <a href={a.prUrl} target="_blank" rel="noreferrer" className="text-signal hover:underline">
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
}: {
  label: string;
  value: number;
  tone: "paper" | "ok" | "signal" | "info";
  sub?: string;
  format?: "currency";
}) {
  const color = {
    paper: "text-paper",
    ok: "text-ok",
    signal: "text-signal",
    info: "text-info",
  }[tone];
  const display = format === "currency" ? `$${value.toFixed(2)}` : String(value);
  return (
    <div className="relative flex flex-col gap-1.5 p-5 border-l border-border first:border-l-0 hover:bg-surface-2/40 transition">
      <div className="mono-label text-paper-muted">{label}</div>
      <div className={cn("serif leading-none num-tabular", color, format === "currency" ? "text-[36px]" : "text-[48px]")}>{display}</div>
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
    dispatch: { label: "dispatch", cls: "border-signal/40 bg-signal/10 text-signal" },
  };
  const c = cfg[kind];
  return (
    <span className={cn("inline-block text-[9px] uppercase tracking-[0.12em] border px-1.5 py-0.5 leading-none w-[72px] text-center", c.cls)}>
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
