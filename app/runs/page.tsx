import { PageHeading } from "@/components/page-heading";
import { Panel } from "@/components/panel";
import { StatusDot } from "@/components/status-dot";
import { loadRuns } from "@/lib/data";
import { formatNumber, formatRelative, pad, shortSha } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await loadRuns(30);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <PageHeading
        eyebrow={`${runs.length} runs · newest first`}
        title={<>Activity</>}
        description="Each row is one pipeline pass — discover, analyze, generate, dispatch. Duration, tokens, model, and outcome per run."
      />

      <div className="mt-6 grid grid-cols-12 gap-6">
        {/* Timeline */}
        <div className="col-span-12 lg:col-span-8 animate-fade-rise">
          <Panel code="L-01" label="transmission log · descending" dense>
            <ol className="relative">
              {runs.map((r, i) => {
                const tone: "ok" | "signal" | "alert" | "muted" =
                  r.status === "success"
                    ? "ok"
                    : r.status === "failed"
                      ? "alert"
                      : "signal";
                return (
                  <li
                    key={r.id}
                    className="relative flex gap-4 px-4 py-4 border-b border-border-soft last:border-0 hover:bg-surface-2/50"
                  >
                    {/* rail */}
                    <div className="relative w-6 shrink-0">
                      <span
                        aria-hidden
                        className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-border"
                      />
                      <span className="absolute left-1/2 -translate-x-1/2 top-5">
                        <StatusDot tone={tone} className="h-2.5 w-2.5" />
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="mono-label text-paper-muted tabular-nums">
                          {pad(runs.length - i, 3)}
                        </span>
                        <span className="text-[13px] text-paper">{r.repo}</span>
                        <span className="text-paper-faint">·</span>
                        <span className="text-[12px] text-paper-muted">PR #{r.pr_number}</span>
                        <span className="text-paper-faint">·</span>
                        <span className="mono-label text-paper-faint tabular-nums">
                          {shortSha(r.repo, r.pr_number)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-paper-muted">
                        <span className="uppercase tracking-[0.12em] text-paper-dim">
                          {r.type.replace(/_/g, " ")}
                        </span>
                        <span>{formatRelative(r.created_at)}</span>
                        <span>
                          duration <span className="text-paper tabular-nums">{r.duration_sec}s</span>
                        </span>
                        <span>
                          findings <span className="text-paper tabular-nums">{r.findings}</span>
                        </span>
                        <span>
                          tokens <span className="text-paper tabular-nums">{formatNumber(r.tokens_used)}</span>
                        </span>
                        <span className="text-paper-faint">·</span>
                        <span className="text-paper-dim">{r.model}</span>
                      </div>
                    </div>

                    <div className="shrink-0 self-center">
                      <DurationBar sec={r.duration_sec} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>

        {/* Aggregates */}
        <aside className="col-span-12 lg:col-span-4 animate-fade-rise stagger-2 space-y-6">
          <Panel code="L-02" label="aggregates">
            <dl className="space-y-4">
              <Stat label="Total runs" value={runs.length} />
              <Stat
                label="Avg duration"
                value={`${Math.round(
                  runs.reduce((a, r) => a + r.duration_sec, 0) / runs.length,
                )}s`}
              />
              <Stat
                label="Total tokens"
                value={formatNumber(runs.reduce((a, r) => a + r.tokens_used, 0))}
              />
              <Stat
                label="Success rate"
                value={`${Math.round(
                  (runs.filter((r) => r.status === "success").length / runs.length) * 100,
                )}%`}
                tone="ok"
              />
            </dl>
          </Panel>

          <Panel code="L-03" label="models in rotation">
            <ul className="space-y-3">
              {Object.entries(
                runs.reduce<Record<string, number>>((acc, r) => {
                  acc[r.model] = (acc[r.model] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .sort((a, b) => b[1] - a[1])
                .map(([m, n]) => {
                  const pct = (n / runs.length) * 100;
                  return (
                    <li key={m}>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-paper">{m}</span>
                        <span className="text-paper-muted tabular-nums">{n}</span>
                      </div>
                      <div className="mt-1 h-1 w-full bg-border-soft overflow-hidden">
                        <div
                          className="h-full bg-signal/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "paper",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "paper" | "ok";
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="mono-label text-paper-muted">{label}</dt>
      <dd
        className={`serif text-[22px] num-tabular ${tone === "ok" ? "text-ok" : "text-paper"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function DurationBar({ sec }: { sec: number }) {
  const max = 300;
  const pct = Math.min(100, (sec / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-border-soft overflow-hidden">
        <div className="h-full bg-paper-dim" style={{ width: `${pct}%` }} />
      </div>
      <span className="mono-label text-paper-muted tabular-nums w-10 text-right">
        {sec}s
      </span>
    </div>
  );
}
