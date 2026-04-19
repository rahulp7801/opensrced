"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusChip, StatusDot } from "./status-dot";
import { IconExternal, IconTrigger } from "./icons";
import { DraftPreview } from "./draft-preview";
import { cn, formatRelative } from "@/lib/utils";

type PrStatus = "opened" | "failed" | "pending" | "tests_passed" | "tests_failed" | "none";

type Dispatch = {
  id: string;
  repo_url: string;
  mode?: "target" | "solve" | "hunt" | "agentic";
  dry_run: boolean;
  issue_number?: number;
  issue_title?: string;
  started_at: string;
  ended_at?: string;
  status: "running" | "succeeded" | "failed" | "killed";
  exit_code?: number;
  pr_status?: PrStatus;
  pr_failure_reason?: string;
};

type DispatchWithLog = Dispatch & { log: string };

export function DispatchList() {
  const searchParams = useSearchParams();
  const initialDispatch = searchParams.get("dispatch");
  const [items, setItems] = useState<Dispatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDispatch);
  const [detail, setDetail] = useState<DispatchWithLog | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareDetail, setCompareDetail] = useState<DispatchWithLog | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const notifiedRef = useRef(new Set<string>());
  const prevRunningRef = useRef(new Set<string>());

  // #7: Request notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Poll dispatch list
  useEffect(() => {
    let live = true;
    async function tick() {
      try {
        const res = await fetch("/api/dispatches", { cache: "no-store" });
        const data = await res.json();
        if (live) {
          const dispatches: Dispatch[] = data.dispatches ?? [];
          // #7: Notify on completion
          for (const d of dispatches) {
            if (
              (d.status === "succeeded" || d.status === "failed") &&
              !notifiedRef.current.has(d.id) &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted" &&
              document.hidden
            ) {
              notifiedRef.current.add(d.id);
              const repo = shortRepo(d.repo_url);
              const body = d.status === "succeeded" && d.pr_status === "opened"
                ? "PR opened successfully"
                : d.status === "succeeded" ? "Completed" : "Failed";
              new Notification(`opensrcer · ${repo}`, { body, icon: "/favicon.ico" });
            }
            if (d.status === "running") notifiedRef.current.add(d.id);
            // Track running dispatches for auto-select on complete
            if (d.status === "running") prevRunningRef.current.add(d.id);
            // Auto-select dispatch that just finished
            if (
              (d.status === "succeeded" || d.status === "failed") &&
              prevRunningRef.current.has(d.id)
            ) {
              prevRunningRef.current.delete(d.id);
              setSelected(d.id);
            }
          }
          setItems(dispatches);
          if (!selected && dispatches[0]) setSelected(dispatches[0].id);
        }
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selected]);

  // Poll selected dispatch's log
  useEffect(() => {
    if (!selected) return;
    let live = true;
    async function tick() {
      try {
        const res = await fetch(`/api/dispatches/${selected}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (live) setDetail(data);
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selected]);

  // Fetch compare dispatch
  useEffect(() => {
    if (!compareId) { setCompareDetail(null); return; }
    let live = true;
    async function tick() {
      try {
        const res = await fetch(`/api/dispatches/${compareId}`, { cache: "no-store" });
        if (res.ok && live) setCompareDetail(await res.json());
      } catch { /* ignore */ }
    }
    tick();
    return () => { live = false; };
  }, [compareId]);

  // Auto-scroll log to bottom when it grows
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [detail?.log]);

  // #10: Loading skeleton
  if (items === null) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-5 lg:col-span-4">
          <div className="border border-border bg-surface/40">
            <div className="border-b border-border px-4 py-2.5">
              <div className="h-4 w-20 bg-surface-3 animate-pulse" />
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 border-b border-border-soft last:border-0 space-y-2">
                <div className="h-3 w-3/4 bg-surface-3 animate-pulse" />
                <div className="h-2.5 w-1/2 bg-surface-2 animate-pulse" />
                <div className="h-2 w-1/3 bg-surface-2 animate-pulse" />
              </div>
            ))}
          </div>
        </aside>
        <section className="col-span-12 md:col-span-7 lg:col-span-8">
          <div className="border border-border bg-surface/40 p-10 text-center text-[12px] text-paper-muted">
            Loading dispatches...
          </div>
        </section>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="border border-border bg-surface/40 p-10 text-center">
        <div className="serif text-[24px] text-paper">No dispatches yet.</div>
        <p className="mt-2 text-[12px] text-paper-muted">
          Paste a repo URL into the command palette ({isMac() ? "⌘K" : "Ctrl K"}) or on the Dispatch page to fire your first pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* List */}
      <aside className="col-span-12 md:col-span-5 lg:col-span-4">
        <div className="border border-border bg-surface/40">
          <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
            <span className="text-[13px] text-paper">Pipelines</span>
            <span className="mono-label text-paper-muted tabular-nums">
              {items.length}
            </span>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto">
            {items.map((d) => (
              <li
                key={d.id}
                className={cn(
                  "border-b border-border-soft last:border-0 cursor-pointer transition-colors",
                  selected === d.id ? "bg-surface-2/80" : "hover:bg-surface-2/40",
                )}
                onClick={() => setSelected(d.id)}
              >
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={toneFor(d.status)} />
                    <span className="text-[12px] text-paper truncate">
                      {shortRepo(d.repo_url)}
                      {d.issue_number !== undefined && (
                        <span className="text-paper-faint"> #{d.issue_number}</span>
                      )}
                    </span>
                    {d.mode === "agentic" && (
                      <span className="ml-auto text-[9px] tracking-[0.12em] uppercase text-info border border-info/40 px-1 py-px leading-none">
                        deep
                      </span>
                    )}
                    {d.mode !== "agentic" && d.dry_run && (
                      <span className="ml-auto text-[9px] tracking-[0.12em] uppercase text-info border border-info/40 px-1 py-px leading-none">
                        dry
                      </span>
                    )}
                  </div>
                  {/* Issue title shows underneath the repo once the cache
                      fills in — renders 'loading title…' until then so the
                      user doesn't see a blank row. Empty title = no issue
                      number on this dispatch (target/hunt modes). */}
                  {d.issue_number !== undefined && (
                    <div className="mt-1 text-[12px] text-paper-dim truncate">
                      {d.issue_title ?? <span className="italic text-paper-faint">loading title…</span>}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-paper-muted">
                    <span className="tabular-nums" title={d.started_at}>
                      {formatAbsoluteOrRelative(d.started_at)}
                    </span>
                    {/* #2: Duration display */}
                    {d.ended_at && (
                      <>
                        <span className="text-paper-faint">·</span>
                        <span className="tabular-nums">{formatDuration(d.started_at, d.ended_at)}</span>
                      </>
                    )}
                    {d.status === "running" && (
                      <>
                        <span className="text-paper-faint">·</span>
                        <span className="tabular-nums text-signal">{formatDuration(d.started_at)}</span>
                      </>
                    )}
                    <span className="text-paper-faint">·</span>
                    <span>
                      {d.status === "succeeded" && d.pr_status === "tests_failed" ? (
                        <span className="text-alert">tests failed</span>
                      ) : d.status === "succeeded" && d.pr_status === "tests_passed" ? (
                        <span className="text-ok">✓ verified</span>
                      ) : d.status === "succeeded" && d.pr_status === "failed" ? (
                        <span className="text-alert">PR failed</span>
                      ) : d.status === "succeeded" && d.pr_status === "pending" ? (
                        <span className="text-signal">opening PR</span>
                      ) : d.status === "succeeded" && d.pr_status === "opened" ? (
                        <span className="text-ok">PR opened</span>
                      ) : (
                        d.status
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 mono-label text-paper-faint tabular-nums truncate">
                    {d.id}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Detail */}
      <section className="col-span-12 md:col-span-7 lg:col-span-8">
        {detail ? (
          <div className="border border-border bg-surface/40">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <IconTrigger className="text-signal" />
                    <a
                      href={detail.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-paper-muted hover:text-signal truncate"
                    >
                      {shortRepo(detail.repo_url)}
                    </a>
                    {detail.issue_number !== undefined && (
                      <a
                        href={`${detail.repo_url.replace(/\/$/, "")}/issues/${detail.issue_number}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-info hover:text-signal border border-info/40 px-1.5 py-0.5 leading-none"
                        title="Open the GitHub issue"
                      >
                        #{detail.issue_number}
                      </a>
                    )}
                  </div>
                  {/* Full issue title as the visual headline. Falls back
                      to the dispatch id if we couldn't resolve one. */}
                  <div className="mt-1.5 text-[17px] text-paper leading-snug truncate">
                    {detail.issue_title ??
                      (detail.issue_number !== undefined
                        ? <span className="italic text-paper-faint">loading title…</span>
                        : <span className="text-paper-muted">Dispatch {detail.id.slice(-8)}</span>)}
                  </div>
                  <IssuePreview log={detail.log} />
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-paper-muted">
                    <span className="tabular-nums" title={detail.started_at}>
                      started {formatAbsoluteOrRelative(detail.started_at)}
                    </span>
                    {detail.ended_at && (
                      <>
                        <span className="text-paper-faint">·</span>
                        <span className="tabular-nums">{formatDuration(detail.started_at, detail.ended_at)}</span>
                      </>
                    )}
                    {(() => {
                      const cost = extractCost(detail.log);
                      if (cost === null) return null;
                      return (
                        <>
                          <span className="text-paper-faint">·</span>
                          <span className="tabular-nums text-signal">${cost.toFixed(4)}</span>
                        </>
                      );
                    })()}
                    <span className="text-paper-faint">·</span>
                    <span className="mono-label text-paper-faint truncate">{detail.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    // Server now computes pr_status from the log on every
                    // /api/dispatches call (see lib/dispatcher.ts::
                    // enrichWithPrStatus). Chip reflects the combined
                    // lifecycle truth — a dispatch that exit=0 but whose
                    // auto-PR failed shows red "PR failed", not green
                    // "succeeded".
                    if (detail.status === "succeeded" && detail.pr_status === "tests_failed") {
                      return (
                        <span title={detail.pr_failure_reason ?? ""}>
                          <StatusChip tone="alert">tests failed</StatusChip>
                        </span>
                      );
                    }
                    if (detail.status === "succeeded" && detail.pr_status === "tests_passed") {
                      return <StatusChip tone="ok">✓ verified</StatusChip>;
                    }
                    if (detail.status === "succeeded" && detail.pr_status === "failed") {
                      return (
                        <span title={detail.pr_failure_reason ?? ""}>
                          <StatusChip tone="alert">PR failed</StatusChip>
                        </span>
                      );
                    }
                    if (detail.status === "succeeded" && detail.pr_status === "pending") {
                      return <StatusChip tone="signal">opening PR…</StatusChip>;
                    }
                    if (detail.status === "succeeded" && detail.pr_status === "opened") {
                      return <StatusChip tone="ok">PR opened</StatusChip>;
                    }
                    return (
                      <StatusChip tone={toneFor(detail.status)}>
                        {detail.status === "running" ? "live" : detail.status}
                      </StatusChip>
                    );
                  })()}
                  <span className="text-[11px] text-paper-muted tabular-nums">
                    {detail.dry_run ? "dry-run" : "live"}
                  </span>
                  {detail.status === "running" && (
                    <CancelButton dispatchId={detail.id} />
                  )}
                  <RetryButton dispatch={detail} />
                  {detail.status !== "running" && <ExportButton dispatch={detail} />}
                  {detail.status !== "running" && items && items.length > 1 && (
                    compareId ? (
                      <button
                        onClick={() => setCompareId(null)}
                        className="border border-info/50 bg-info/10 text-info px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
                      >
                        exit compare
                      </button>
                    ) : (
                      <select
                        onChange={(e) => setCompareId(e.target.value || null)}
                        value=""
                        className="bg-surface border border-border text-paper-muted px-2 py-0.5 text-[10px] max-w-[140px]"
                      >
                        <option value="">compare...</option>
                        {items.filter((d) => d.id !== detail.id && d.status !== "running").map((d) => (
                          <option key={d.id} value={d.id}>
                            {shortRepo(d.repo_url)} {d.issue_number !== undefined ? `#${d.issue_number}` : d.id.slice(-8)}
                          </option>
                        ))}
                      </select>
                    )
                  )}
                </div>
              </div>
            </div>
            {/* Pipeline milestone badges + timeline */}
            {detail.log && (
              <div className="border-b border-border px-4 py-2.5 space-y-2">
                <PipelineTimeline log={detail.log} status={detail.status} />
                {detail.status !== "running" && <StatusSummary log={detail.log} />}
              </div>
            )}
            {/* Auto-PR failure banner — appears when Claude succeeded but
                the post-hook auto-PR step didn't open a PR. Explains the
                reason so the user can see whether to retry or fix manually. */}
            {detail.pr_status === "failed" && (
              <div className="border-t border-b border-alert/40 bg-alert/5 px-4 py-3 flex items-start gap-3 flex-wrap">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-alert/60 bg-alert/15 text-alert text-[12px] shrink-0">!</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-alert">Auto-PR step failed</div>
                  <div className="mt-0.5 text-[11.5px] text-paper-muted leading-snug break-words">
                    {detail.pr_failure_reason ?? "No failure reason captured."}
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-paper-faint leading-snug">
                    Claude&apos;s output is still intact in the log below — use <span className="text-paper-dim">copy diff</span> on the patch preview to apply it by hand, or retry the dispatch.
                  </div>
                </div>
              </div>
            )}
            {detail.pr_status === "tests_failed" && (
              <div className="border-t border-b border-alert/40 bg-alert/5 px-4 py-3 flex items-start gap-3 flex-wrap">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-alert/60 bg-alert/15 text-alert text-[12px] shrink-0">!</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-alert">Tests failed — PR not opened</div>
                  <div className="mt-0.5 text-[11.5px] text-paper-muted leading-snug break-words">
                    {detail.pr_failure_reason ?? "Sandbox test run failed. See [crucible-tests] block in the log below."}
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-paper-faint leading-snug">
                    The patch was rejected because the repo&apos;s own test suite didn&apos;t pass. Review the failures below, then retry or copy the diff and refine by hand.
                  </div>
                </div>
              </div>
            )}

            {/* PR banner — surfaces the moment a PR URL lands in the log.
                Works for both the deterministic contribai path (prints
                'PR created  url=...') and the agentic path (writes
                '[agentic-pr] opened draft PR: ...'). Any github.com/<o>/<r>/pull/<n>
                URL is recognised. */}
            {(() => {
              const info = extractPrInfo(detail.log);
              if (!info) return null;
              return (
                <div className="border-t border-b border-ok/40 bg-ok/5 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-ok/60 bg-ok/15 text-ok text-[12px]">✓</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ok flex items-center gap-2">
                      Draft PR opened <Confetti />
                    </div>
                    <div className="mt-0.5 text-[11px] text-paper-muted truncate">
                      {info.repoFull} · #{info.prNumber}
                    </div>
                  </div>
                  <CopyPrUrl url={info.url} />
                  <a
                    href={info.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20 px-3 py-1.5 text-[12px]"
                  >
                    Open PR #{info.prNumber}
                    <IconExternal />
                  </a>
                </div>
              );
            })()}

            {/* Agentic diff preview — if a fenced ```diff block is in the
                log, render a collapsible colorised view. Lets the user
                eyeball the patch without leaving the dashboard (and
                especially useful when auto-PR failed so there's no GitHub
                URL to click through to). */}
            <DiffPreviewFromLog log={detail.log} prOpened={!!extractPrInfo(detail.log)} />

            {compareDetail ? (
              <div className="grid grid-cols-2 divide-x divide-border">
                <div>
                  <div className="px-3 py-1.5 text-[10px] text-paper-muted border-b border-border-soft bg-surface/30">
                    current: {shortRepo(detail.repo_url)} {detail.issue_number !== undefined && `#${detail.issue_number}`}
                  </div>
                  <pre className="h-[40vh] overflow-auto p-3 text-[10.5px] leading-relaxed text-paper-dim bg-ink/70 font-mono whitespace-pre-wrap">
                    {stripAnsi(detail.log) || "(empty)"}
                  </pre>
                </div>
                <div>
                  <div className="px-3 py-1.5 text-[10px] text-info border-b border-border-soft bg-info/5">
                    compare: {shortRepo(compareDetail.repo_url)} {compareDetail.issue_number !== undefined && `#${compareDetail.issue_number}`}
                  </div>
                  <pre className="h-[40vh] overflow-auto p-3 text-[10.5px] leading-relaxed text-paper-dim bg-ink/70 font-mono whitespace-pre-wrap">
                    {stripAnsi(compareDetail.log) || "(empty)"}
                  </pre>
                </div>
              </div>
            ) : (
              <LogViewer log={detail.log} isRunning={detail.status === "running"} logRef={logRef} />
            )}
            <DraftPreview dispatchId={detail.id} repoUrl={detail.repo_url} />
          </div>
        ) : (
          <div className="border border-border bg-surface/40 p-10 text-center text-[12px] text-paper-muted">
            Select a dispatch to view its log.
          </div>
        )}
      </section>
    </div>
  );
}

// ── Retry button ────────────────────────────────────────────────────
function RetryButton({ dispatch }: { dispatch: DispatchWithLog }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dispatch.status !== "failed" && dispatch.status !== "killed") return null;
  if (!dispatch.issue_number && !dispatch.repo_url) return null;

  async function retry() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/run/agentic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo_url: dispatch.repo_url,
          issue_number: dispatch.issue_number,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { dispatch_id?: string };
      if (json.dispatch_id) {
        window.location.href = `/dispatches?dispatch=${json.dispatch_id}`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={retry}
        disabled={pending}
        className="border border-signal/50 bg-signal/10 text-signal hover:bg-signal/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] disabled:opacity-50"
      >
        {pending ? "retrying…" : "retry"}
      </button>
      {error && <span className="text-[10px] text-alert">{error}</span>}
    </div>
  );
}

// ── Status summary badges ─────────────────────────────────────────────
function StatusSummary({ log }: { log: string }) {
  if (!log) return null;

  const hasDiff = /```(?:diff|patch)/m.test(log);
  const testsRan = /\[crucible-tests\]/.test(log);
  const testsPassed = /\[crucible-tests\] status=passed/.test(log);
  const testsFailed = /\[crucible-tests\] status=(?:failed|error)/.test(log);
  const prOpened = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(log);
  const geminiReviewed = /\[gemini-review\]/.test(log);

  const costMatch = /(?:Total cost|cost)[=:]\s*\$?([\d.]+)/i.exec(log);
  const cost = costMatch ? parseFloat(costMatch[1]) : null;

  const badges: Array<{ label: string; tone: "ok" | "alert" | "muted" | "info" | "signal" }> = [];

  if (hasDiff) badges.push({ label: "patch", tone: "ok" });
  if (geminiReviewed) badges.push({ label: "reviewed", tone: "info" });
  if (testsRan) {
    if (testsPassed) badges.push({ label: "tests passed", tone: "ok" });
    else if (testsFailed) badges.push({ label: "tests failed", tone: "alert" });
    else badges.push({ label: "tests ran", tone: "signal" });
  }
  if (prOpened) badges.push({ label: "PR opened", tone: "ok" });

  if (badges.length === 0 && !cost) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {badges.map((b) => (
        <span
          key={b.label}
          className={cn(
            "text-[9px] tracking-[0.1em] uppercase px-1.5 py-px border leading-none",
            b.tone === "ok" && "border-ok/40 text-ok",
            b.tone === "alert" && "border-alert/40 text-alert",
            b.tone === "info" && "border-info/40 text-info",
            b.tone === "signal" && "border-signal/40 text-signal",
            b.tone === "muted" && "border-border text-paper-muted",
          )}
        >
          {b.label}
        </span>
      ))}
      {cost !== null && cost > 0 && (
        <span className="text-[9px] tracking-[0.1em] text-paper-muted tabular-nums">
          ${cost.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function CancelButton({ dispatchId }: { dispatchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  async function cancel() {
    setPending(true);
    try {
      await fetch(`/api/dispatches/${dispatchId}/cancel`, { method: "POST" });
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }
  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          onClick={cancel}
          disabled={pending}
          className="border border-alert bg-alert/10 text-alert px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] hover:bg-alert/20 disabled:opacity-50"
        >
          {pending ? "…" : "confirm kill"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] text-paper-muted hover:text-paper"
        >
          cancel
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      className="border border-border text-paper-muted hover:text-alert hover:border-alert/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
      title="Stop the opensrcer agent subprocess"
    >
      ■ stop
    </button>
  );
}

// #2: Format duration between two ISO timestamps (or from start to now)
function formatDuration(start: string, end?: string): string {
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "";
  const ms = Math.max(0, e - s);
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs.toString().padStart(2, "0")}s`;
}

// #3: Copy button for PR URL
function CopyPrUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 border border-border hover:border-border-strong px-2 py-1.5 text-[11px] text-paper-dim hover:text-paper transition"
    >
      {copied ? "copied" : "copy url"}
    </button>
  );
}

// Parse total cost from dispatch log. Claude Code outputs "total_cost_usd":N
// in stream-json mode, and the agentic dispatcher may echo it.
function extractCost(log: string): number | null {
  if (!log) return null;
  // Match our dispatcher's cost line: total_cost_usd=0.123456
  const dispatcherMatch = /total_cost_usd=([\d.]+)/.exec(log);
  if (dispatcherMatch) return parseFloat(dispatcherMatch[1]);
  // Match Claude Code's JSON output
  const jsonMatch = /"total_cost_usd"\s*:\s*([\d.]+)/.exec(log);
  if (jsonMatch) return parseFloat(jsonMatch[1]);
  // Match budget exceeded message which tells us the cap
  const budgetMatch = /Exceeded USD budget \(([\d.]+)\)/.exec(log);
  if (budgetMatch) return parseFloat(budgetMatch[1]);
  return null;
}

// Celebration effect on PR opened
function Confetti() {
  const particles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 360;
    const distance = 8 + Math.random() * 12;
    const x = Math.cos((angle * Math.PI) / 180) * distance;
    const y = Math.sin((angle * Math.PI) / 180) * distance;
    const colors = ["text-ok", "text-signal", "text-info", "text-alert"];
    const shapes = ["\u2022", "\u2726", "\u2727", "\u25CF"];
    return { x, y, color: colors[i % colors.length], shape: shapes[i % shapes.length], delay: i * 30 };
  });

  return (
    <span className="relative inline-block w-5 h-5">
      {particles.map((p, i) => (
        <span
          key={i}
          className={`absolute left-1/2 top-1/2 ${p.color}`}
          style={{
            fontSize: "6px",
            opacity: 0,
            animation: `confetti-burst 0.8s ease-out ${p.delay}ms forwards`,
            ["--tx" as string]: `${p.x}px`,
            ["--ty" as string]: `${p.y}px`,
          }}
        >
          {p.shape}
        </span>
      ))}
    </span>
  );
}

function IssuePreview({ log }: { log: string }) {
  const [expanded, setExpanded] = useState(false);
  // Extract issue body from the log — it appears between the issue title
  // header and "## Your tools" or the dispatcher separator
  const bodyMatch = /^# .+?\n\n(?:URL: .+\nLabels: .+\n\n)?([\s\S]+?)(?=\n## Your tools|\n## Required first step|\n\[agentic-dispatcher\])/m.exec(log);
  if (!bodyMatch || !bodyMatch[1].trim()) return null;
  const body = bodyMatch[1].trim();
  if (body.length < 20) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-paper-faint hover:text-paper-muted"
      >
        {expanded ? "hide issue body" : "show issue body"}
      </button>
      {expanded && (
        <div className="mt-1.5 text-[11.5px] text-paper-dim leading-relaxed border-l-2 border-border-soft pl-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {body.slice(0, 1000)}
          {body.length > 1000 && "…"}
        </div>
      )}
    </div>
  );
}

function LogViewer({ log, isRunning, logRef }: { log: string; isRunning: boolean; logRef: React.RefObject<HTMLPreElement | null> }) {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const clean = stripAnsi(log);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && logRef.current) {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setSearch("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch, logRef]);

  const matchCount = search.length >= 2
    ? (clean.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length
    : 0;

  function renderLog(): React.ReactNode {
    if (!search || search.length < 2) return clean || "(log empty — waiting for first write)";
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = clean.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase()
        ? <mark key={i} className="bg-signal/30 text-signal">{part}</mark>
        : part
    );
  }

  return (
    <div className="relative">
      {isRunning && !showSearch && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-[10px] text-signal">
          <StatusDot tone="signal" /> streaming
        </div>
      )}
      {showSearch && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search log..."
            className="bg-ink/90 border border-border px-2 py-1 text-[11px] text-paper w-48 focus:outline-none focus:border-signal/50"
          />
          {search.length >= 2 && (
            <span className="text-[10px] text-paper-muted tabular-nums">{matchCount}</span>
          )}
          <button onClick={() => { setShowSearch(false); setSearch(""); }} className="text-[11px] text-paper-muted hover:text-paper">×</button>
        </div>
      )}
      {!showSearch && !isRunning && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5">
          <button
            onClick={() => setRawMode(!rawMode)}
            className={cn(
              "border bg-ink/80 px-2 py-1 text-[10px] transition",
              rawMode ? "border-signal/50 text-signal" : "border-border text-paper-faint hover:text-paper-muted"
            )}
            title="Toggle terminal colors"
          >
            {rawMode ? "colored" : "plain"}
          </button>
          <button
            onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 50); }}
            className="flex items-center gap-1 border border-border bg-ink/80 hover:border-signal/50 hover:text-signal px-2 py-1 text-[10px] text-paper-muted transition"
            title="Search log (Ctrl+F)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4" /><path d="m13 13-3.5-3.5" /></svg>
            search
          </button>
        </div>
      )}
      <pre ref={logRef} className="h-[50vh] overflow-auto p-4 text-[11.5px] leading-relaxed text-paper-dim bg-ink/70 font-mono whitespace-pre-wrap">
        {search.length >= 2 ? renderLog() : rawMode ? <AnsiLog text={log} /> : (clean || "(log empty — waiting for first write)")}
      </pre>
    </div>
  );
}

// ANSI color renderer — converts escape sequences to styled spans
const ANSI_COLORS: Record<number, string> = {
  30: "color: #6b6557", 31: "color: #ff5c5c", 32: "color: #7fe83f",
  33: "color: #ff9d2e", 34: "color: #5ec8ff", 35: "color: #d898ff",
  36: "color: #5ec8ff", 37: "color: #ece5d1",
  90: "color: #6b6557", 91: "color: #ff5c5c", 92: "color: #7fe83f",
  93: "color: #ffb866", 94: "color: #5ec8ff", 95: "color: #d898ff",
  96: "color: #5ec8ff", 97: "color: #ece5d1",
};

function AnsiLog({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let style = "";
  let bold = false;
  let ki = 0;

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(
        <span key={ki++} style={style || bold ? { ...(style ? { cssText: style } : {}), ...(bold ? { fontWeight: 600 } : {}) } as React.CSSProperties : undefined}>
          {text.slice(last, match.index)}
        </span>
      );
    }
    const codes = match[1].split(";").map(Number);
    for (const c of codes) {
      if (c === 0) { style = ""; bold = false; }
      else if (c === 1) bold = true;
      else if (ANSI_COLORS[c]) style = ANSI_COLORS[c];
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(<span key={ki++}>{text.slice(last)}</span>);
  }
  return <>{parts}</>;
}

function ExportButton({ dispatch }: { dispatch: DispatchWithLog }) {
  function download() {
    const repo = shortRepo(dispatch.repo_url);
    const prInfo = extractPrInfo(dispatch.log);
    const diff = extractFirstDiff(dispatch.log);
    const costMatch = /total_cost_usd=([\d.]+)/.exec(dispatch.log);
    const cost = costMatch ? parseFloat(costMatch[1]) : null;

    const parts = [
      `# Dispatch Report`,
      ``,
      `- **Repo:** ${repo}`,
      dispatch.issue_number !== undefined ? `- **Issue:** #${dispatch.issue_number}` : null,
      `- **Status:** ${dispatch.status}`,
      `- **Started:** ${dispatch.started_at}`,
      dispatch.ended_at ? `- **Ended:** ${dispatch.ended_at}` : null,
      dispatch.ended_at ? `- **Duration:** ${formatDuration(dispatch.started_at, dispatch.ended_at)}` : null,
      cost !== null ? `- **Cost:** $${cost.toFixed(4)}` : null,
      prInfo ? `- **PR:** [#${prInfo.prNumber}](${prInfo.url})` : null,
      ``,
    ].filter(Boolean);

    if (diff) {
      parts.push(`## Patch`, ``, "```diff", diff.body, "```", ``);
    }

    parts.push(`## Full Log`, ``, "```", stripAnsi(dispatch.log), "```");

    const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dispatch.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      className="border border-border text-paper-muted hover:text-paper hover:border-border-strong px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
      title="Download dispatch report as .md"
    >
      export
    </button>
  );
}

function PipelineTimeline({ log, status }: { log: string; status: string }) {
  const phases = [
    { label: "clone", done: /\[agentic-dispatcher\].*repo:/.test(log), active: status === "running" && !/grep|read_file|find_definition/.test(log), failed: false },
    { label: "explore", done: /find_definition|read_file|grep|list_files|repo_info/.test(log), active: status === "running" && /find_definition|read_file|grep/.test(log) && !/```diff/.test(log), failed: false },
    { label: "patch", done: /```(?:diff|patch)/.test(log), active: status === "running" && /## Diagnosis/.test(log) && !/```diff/.test(log), failed: status !== "running" && !/```(?:diff|patch)/.test(log) && /exited at/.test(log) },
    { label: "test", done: /\[crucible-tests\]/.test(log), active: /\[agentic-pr\] starting/.test(log) && !/\[crucible-tests\]/.test(log), failed: /\[crucible-tests\] status=(?:failed|error)/.test(log) },
    { label: "PR", done: /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(log), active: /\[agentic-pr\] starting/.test(log) && !/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(log) && !/skipped:/.test(log), failed: /\[agentic-pr\] skipped:/.test(log) },
  ];

  return (
    <div className="flex items-center gap-1">
      {phases.map((p, i) => (
        <div key={p.label} className="flex items-center gap-1">
          {i > 0 && <div className={cn("w-4 h-px", p.done || p.active ? "bg-signal/40" : "bg-border")} />}
          <span
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] border leading-none",
              p.failed ? "border-alert/40 text-alert" :
              p.done ? "border-ok/40 text-ok" :
              p.active ? "border-signal/40 text-signal" :
              "border-border-soft text-paper-faint",
            )}
          >
            {p.failed ? "×" : p.done ? "✓" : p.active ? "●" : "○"} {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function toneFor(s: Dispatch["status"]): "ok" | "signal" | "alert" | "muted" {
  if (s === "running") return "signal";
  if (s === "succeeded") return "ok";
  if (s === "failed" || s === "killed") return "alert";
  return "muted";
}

function shortRepo(url: string) {
  const m = /github\.com\/([^/]+\/[^/?#]+)/.exec(url);
  return m ? m[1] : url;
}

// Dispatcher falls back to `new Date(0).toISOString()` = 1970 when it
// couldn't parse a start timestamp out of the log header. Render that
// explicitly instead of "55 years ago" — the latter is what the user
// was seeing when agentic logs failed the regex pre-v2.9.
function formatAbsoluteOrRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < 86_400_000) return "unknown time";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  // Within 24h → relative ("12m ago", "3h ago")
  if (diff < 86_400_000) return formatRelative(iso);
  // Older → absolute date
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stripAnsi(s: string) {
  // Remove ANSI escape sequences so the log renders clean in a <pre>.
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, "");
}

type DiffStats = { files: string[]; additions: number; deletions: number; body: string };

// Pull the first fenced ```diff / ```patch block out of the log, also
// tolerating a bare ``` block that starts with '--- a/'. Same shape as
// lib/agentic-pr.ts::extractFirstDiff but lives client-side.
function extractFirstDiff(log: string): DiffStats | null {
  if (!log) return null;
  const fenced = /```(?:diff|patch|)\s*\n([\s\S]*?)```/g;
  for (const m of log.matchAll(fenced)) {
    const body = m[1];
    if (!/^--- a\//m.test(body) || !/^\+\+\+ b\//m.test(body)) continue;
    const files = [...body.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((x) => x[1]);
    let adds = 0, dels = 0;
    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
      if (line.startsWith("+")) adds++;
      else if (line.startsWith("-")) dels++;
    }
    return { files, additions: adds, deletions: dels, body };
  }
  return null;
}

// Lightweight markdown→JSX for Claude's summary sections. Handles bold,
// inline code, bullets, numbered lists, and paragraphs — enough for the
// structured output Claude produces without a heavy lib.
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5 text-[12.5px] text-paper-dim leading-relaxed">
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Bullet list
        if (/^[-*]\s/m.test(trimmed)) {
          const items = trimmed.split(/\n/).filter((l) => l.trim());
          return (
            <ul key={bi} className="space-y-1 ml-1">
              {items.map((item, ii) => (
                <li key={ii} className="flex gap-2">
                  <span className="text-paper-faint shrink-0 mt-px">-</span>
                  <span><InlineMarkdown text={item.replace(/^[-*]\s+/, "")} /></span>
                </li>
              ))}
            </ul>
          );
        }

        // Numbered list
        if (/^\d+[.)]\s/m.test(trimmed)) {
          const items = trimmed.split(/\n/).filter((l) => l.trim());
          return (
            <ol key={bi} className="space-y-1 ml-1">
              {items.map((item, ii) => {
                const m = item.match(/^(\d+)[.)]\s+(.*)/);
                return (
                  <li key={ii} className="flex gap-2">
                    <span className="text-paper-faint shrink-0 tabular-nums mt-px">{m?.[1] ?? ii + 1}.</span>
                    <span><InlineMarkdown text={m?.[2] ?? item} /></span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Regular paragraph
        return (
          <p key={bi}>
            <InlineMarkdown text={trimmed.replace(/\n/g, " ")} />
          </p>
        );
      })}
    </div>
  );
}

// Inline markdown: **bold**, `code`, *italic*, [link](url)
function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  // Split on bold, code, and backtick patterns
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let ki = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const tok = match[0];
    if (tok.startsWith("**") && tok.endsWith("**")) {
      parts.push(
        <strong key={ki++} className="text-paper font-medium">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      parts.push(
        <code key={ki++} className="text-signal bg-signal/10 px-1 py-0.5 text-[11.5px]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      parts.push(
        <em key={ki++} className="text-paper-dim italic">{tok.slice(1, -1)}</em>
      );
    }
    last = match.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// Extract Claude's structured sections from the log for the summary.
function extractLogSection(log: string, headingAlt: string): string | null {
  const re = new RegExp(
    `^##\\s+(?:${headingAlt})\\s*\\n([\\s\\S]+?)(?=\\n##\\s|\\n\\[agentic-|\\n\`\`\`(?:diff|patch)|$)`,
    "im",
  );
  return re.exec(log)?.[1]?.trim() ?? null;
}

function DiffPreviewFromLog({ log, prOpened }: { log: string; prOpened: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [splitView, setSplitView] = useState(false);

  const diff = extractFirstDiff(log);
  if (!diff) return null;

  const diagnosis = extractLogSection(log, "Diagnosis|Analysis|Root cause|Problem");
  const risk = extractLogSection(log, "Risk\\s*/\\s*Test|Risk / test|Risk and test|Testing|Test notes");
  const prTitle = extractLogSection(log, "PR title|Suggested PR title|Title");
  const prInfo = extractPrInfo(log);

  async function copyDiff() {
    try {
      await navigator.clipboard.writeText(diff!.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard denied */ }
  }

  return (
    <>
      {/* Inline summary bar — click to open modal */}
      <div className="border-t border-border bg-surface/40">
        <button
          onClick={() => setModalOpen(true)}
          className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-surface-2/40 transition-colors"
        >
          <span className="text-[13px] text-paper font-medium">Review patch</span>
          <span className="text-[11px] text-paper-muted tabular-nums">
            {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
          </span>
          <span className="text-[11px] text-ok tabular-nums">+{diff.additions}</span>
          <span className="text-[11px] text-alert tabular-nums">-{diff.deletions}</span>
          <span className="ml-auto text-[11px] text-signal">
            open review →
          </span>
        </button>
      </div>

      {/* Full-screen modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/90 backdrop-blur-sm overflow-y-auto py-8 px-4">
          <div className="w-full max-w-4xl border border-border bg-ink">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <div className="text-[16px] text-paper font-medium">
                  {prTitle?.split("\n")[0]?.replace(/^[#>*\-`\s]+/, "") || "Proposed patch"}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-paper-muted">
                  <span>{diff.files.length} file{diff.files.length === 1 ? "" : "s"} changed</span>
                  <span className="text-ok">+{diff.additions} additions</span>
                  <span className="text-alert">-{diff.deletions} deletions</span>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-paper-muted hover:text-paper text-[18px] px-2"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Diagnosis + Risk summary */}
            {(diagnosis || risk) && (
              <div className="px-6 py-5 border-b border-border-soft space-y-5">
                {diagnosis && (
                  <div>
                    <div className="mono-label text-paper-muted mb-2">What was found</div>
                    <Markdown text={diagnosis} />
                  </div>
                )}
                {risk && (
                  <div>
                    <div className="mono-label text-paper-muted mb-2">Risk &amp; testing</div>
                    <Markdown text={risk} />
                  </div>
                )}
              </div>
            )}

            {/* File list */}
            <div className="px-6 py-3 border-b border-border-soft bg-surface/30 flex items-center gap-2 text-[11px] text-paper-muted flex-wrap">
              <span className="font-medium text-paper-dim">Files:</span>
              {diff.files.map((f) => (
                <code key={f} className="text-paper-dim bg-ink/60 px-1.5 py-0.5">{f}</code>
              ))}
            </div>

            {/* Diff view toggle */}
            <div className="px-6 py-2 border-b border-border-soft flex items-center gap-2">
              <button
                onClick={() => setSplitView(false)}
                className={cn("text-[10px] px-2 py-0.5 border transition", !splitView ? "border-signal/50 text-signal" : "border-border text-paper-faint hover:text-paper-muted")}
              >
                unified
              </button>
              <button
                onClick={() => setSplitView(true)}
                className={cn("text-[10px] px-2 py-0.5 border transition", splitView ? "border-signal/50 text-signal" : "border-border text-paper-faint hover:text-paper-muted")}
              >
                split
              </button>
            </div>

            {/* Diff */}
            {splitView ? (
              <SplitDiffView body={diff.body} />
            ) : (
              <pre className="max-h-[50vh] overflow-auto text-[11.5px] leading-snug font-mono bg-ink/70">
                {diff.body.split(/\r?\n/).map((line, i) => (
                  <DiffLine key={i} line={line} />
                ))}
              </pre>
            )}

            {/* Actions */}
            <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <button
                  onClick={copyDiff}
                  className="inline-flex items-center gap-1.5 border border-border hover:border-border-strong px-3 py-2 text-[12px] text-paper-dim hover:text-paper transition"
                >
                  {copied ? "Copied ✓" : "Copy diff"}
                </button>
                <CommitMsgButton
                  title={prTitle?.split("\n")[0]?.replace(/^[#>*\-`\s]+/, "") ?? null}
                  diagnosis={diagnosis}
                  files={diff.files}
                />
                <button
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-2 text-[12px] text-paper-muted hover:text-paper transition"
                >
                  Close
                </button>
              </div>
              <div className="flex items-center gap-3">
                {prInfo ? (
                  <a
                    href={prInfo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20 px-4 py-2 text-[12px] transition"
                  >
                    View PR #{prInfo.prNumber}
                    <IconExternal />
                  </a>
                ) : prOpened ? null : (
                  <span className="text-[11px] text-paper-faint">
                    PR will be opened automatically if tests pass
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CommitMsgButton({
  title,
  diagnosis,
  files,
}: {
  title: string | null;
  diagnosis: string | null;
  files: string[];
}) {
  const [copied, setCopied] = useState(false);

  function generate() {
    const subject = title || "fix: apply patch";
    const body = diagnosis
      ? `\n\n${diagnosis.split("\n").slice(0, 5).join("\n").trim()}`
      : "";
    const fileList = files.length > 0
      ? `\n\nFiles: ${files.join(", ")}`
      : "";
    const msg = `${subject}${body}${fileList}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  return (
    <button
      onClick={generate}
      className="inline-flex items-center gap-1.5 border border-border hover:border-border-strong px-3 py-2 text-[12px] text-paper-dim hover:text-paper transition"
    >
      {copied ? "Copied ✓" : "Commit msg"}
    </button>
  );
}

function SplitDiffView({ body }: { body: string }) {
  // Parse hunks into before/after line pairs
  const lines = body.split(/\r?\n/);
  const hunks: Array<{ file: string; before: string[]; after: string[] }> = [];
  let currentFile = "";
  let before: string[] = [];
  let after: string[] = [];

  for (const line of lines) {
    if (line.startsWith("--- a/")) continue;
    if (line.startsWith("+++ b/")) {
      if (currentFile && (before.length || after.length)) {
        hunks.push({ file: currentFile, before: [...before], after: [...after] });
      }
      currentFile = line.slice(6);
      before = [];
      after = [];
      continue;
    }
    if (line.startsWith("@@")) {
      if (before.length || after.length) {
        hunks.push({ file: currentFile, before: [...before], after: [...after] });
        before = [];
        after = [];
      }
      continue;
    }
    if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else {
      // Context line — add to both
      const ctx = line.startsWith(" ") ? line.slice(1) : line;
      before.push(ctx);
      after.push(ctx);
    }
  }
  if (currentFile && (before.length || after.length)) {
    hunks.push({ file: currentFile, before, after });
  }

  return (
    <div className="max-h-[50vh] overflow-auto">
      {hunks.map((h, hi) => (
        <div key={hi}>
          <div className="px-4 py-1.5 text-[10px] text-paper-muted bg-surface/30 border-b border-border-soft font-mono">
            {h.file}
          </div>
          <div className="grid grid-cols-2 divide-x divide-border-soft">
            <pre className="p-3 text-[11px] leading-snug font-mono bg-alert/5 overflow-x-auto">
              {h.before.map((l, i) => (
                <div key={i} className="whitespace-pre text-paper-dim">{l || "\u00a0"}</div>
              ))}
            </pre>
            <pre className="p-3 text-[11px] leading-snug font-mono bg-ok/5 overflow-x-auto">
              {h.after.map((l, i) => (
                <div key={i} className="whitespace-pre text-paper-dim">{l || "\u00a0"}</div>
              ))}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  // Coloring rules mirror GitHub's:
  //   +++ / ---           file header (bold, paper)
  //   @@                  hunk header (info tone)
  //   +<text>             addition (green wash)
  //   -<text>             deletion (red wash)
  //   default             context (muted)
  let cls = "text-paper-dim";
  let bg = "";
  if (line.startsWith("+++") || line.startsWith("---")) {
    cls = "text-paper font-semibold";
  } else if (line.startsWith("@@")) {
    cls = "text-info";
    bg = "bg-info/10";
  } else if (line.startsWith("+")) {
    cls = "text-ok";
    bg = "bg-ok/10";
  } else if (line.startsWith("-")) {
    cls = "text-alert";
    bg = "bg-alert/10";
  }
  return (
    <div className={cn("px-4 whitespace-pre", cls, bg)}>
      {line || "\u00a0"}
    </div>
  );
}

type PrInfo = { url: string; repoFull: string; prNumber: number };

// Scan the dispatch log for the first GitHub PR URL and parse owner/repo/n.
// One regex handles both producers:
//   deterministic contribai: '✅ PR #N created → https://github.com/.../pull/N'
//                          + 'INFO PR created ... url=https://github.com/.../pull/N'
//   agentic auto-PR:        '[agentic-pr] opened draft PR: https://github.com/.../pull/N'
function extractPrInfo(log: string): PrInfo | null {
  if (!log) return null;
  const m = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(log);
  if (!m) return null;
  return {
    url: `https://github.com/${m[1]}/pull/${m[2]}`,
    repoFull: m[1],
    prNumber: Number(m[2]),
  };
}

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
