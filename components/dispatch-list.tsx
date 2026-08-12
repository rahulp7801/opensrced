"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusChip, StatusDot } from "./status-dot";
import { IconExternal, IconTrigger } from "./icons";
import { DraftPreview } from "./draft-preview";
import { cn, formatRelative } from "@/lib/utils";
import { parseSplitHunks, type DiffRow } from "@/lib/diff-view";

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
  pr_url?: string;
  /** Whether the repo's own suite ran against the patch. "Verified" in the
   *  UI must mean `passed` and nothing else. */
  tests?: "passed" | "failed" | "skipped" | "not_run";
};

type DispatchWithLog = Dispatch & { log: string };

export function DispatchList() {
  const searchParams = useSearchParams();
  const initialDispatch = searchParams.get("dispatch");
  const [items, setItems] = useState<Dispatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDispatch);
  const [detail, setDetail] = useState<DispatchWithLog | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  // Dispatches we have already raised a desktop notification for.
  const notifiedRef = useRef(new Set<string>());
  // Dispatches we have observed in the `running` state during this session.
  // A completion is only interesting if we watched it run.
  const seenRunningRef = useRef(new Set<string>());
  // Has the user clicked a row? Once they have, nothing may move the
  // selection out from under them.
  const userPickedRef = useRef(Boolean(initialDispatch));
  // Read inside the poll loop without making it a dependency — see below.
  const selectedRef = useRef<string | null>(initialDispatch);

  const pick = useCallback((id: string) => {
    userPickedRef.current = true;
    selectedRef.current = id;
    setSelected(id);
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Poll dispatch list.
  //
  // Deps are empty on purpose. This used to depend on `selected`, so every
  // click tore the 2.5s interval down and built a new one — the poll cadence
  // restarted from zero on each selection, and the effect re-ran only to read
  // one value. `selectedRef` gives the loop the current selection without
  // making the subscription depend on it.
  useEffect(() => {
    let live = true;
    async function tick() {
      try {
        const res = await fetch("/api/dispatches", { cache: "no-store" });
        const data = await res.json();
        if (!live) return;
        const dispatches: Dispatch[] = data.dispatches ?? [];

        for (const d of dispatches) {
          if (d.status === "running") {
            seenRunningRef.current.add(d.id);
            continue;
          }
          const finished = d.status === "succeeded" || d.status === "failed";
          if (!finished || !seenRunningRef.current.has(d.id)) continue;

          // Notify once, for a run we actually watched start.
          //
          // The old code added every running dispatch to `notifiedRef`, which
          // is the set meaning "already notified" — so by the time a run
          // finished it was always in the set and the notification was
          // suppressed. The feature only ever fired for dispatches that were
          // already finished on first load, which is precisely the case where
          // nobody is waiting on one.
          if (
            !notifiedRef.current.has(d.id) &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            notifiedRef.current.add(d.id);
            const body =
              d.status === "succeeded" && d.pr_status === "opened"
                ? "PR opened successfully"
                : d.status === "succeeded"
                  ? "Completed"
                  : "Failed";
            new Notification(`opensrcer · ${shortRepo(d.repo_url)}`, {
              body,
              icon: "/favicon.ico",
            });
          }

          // Surface a finished run only if the user is not reading something
          // else. Previously any completion called setSelected, so a
          // background run finishing yanked you out of the log you were
          // mid-way through reading.
          seenRunningRef.current.delete(d.id);
          if (!userPickedRef.current) {
            selectedRef.current = d.id;
            setSelected(d.id);
          }
        }

        setItems(dispatches);
        if (!selectedRef.current && dispatches[0]) {
          selectedRef.current = dispatches[0].id;
          setSelected(dispatches[0].id);
        }
      } catch {
        /* transient network failure — the next tick retries */
      }
    }
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  // Poll selected dispatch's log incrementally: ask only for bytes written
  // since the last poll and append them. The server used to resend the
  // whole log (up to 200KB) every 1.5s.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    let offset = 0; // bytes of this dispatch's log already held
    async function tick() {
      try {
        const res = await fetch(`/api/dispatches/${selected}?since=${offset}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as DispatchWithLog & {
          log_size?: number;
          log_reset?: boolean;
        };
        if (!live) return;
        offset = data.log_size ?? 0;
        setDetail((prev) => {
          // reset (or a different dispatch, or the first poll) → replace
          if (data.log_reset || !prev || prev.id !== data.id) return data;
          return { ...data, log: prev.log + data.log };
        });
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

  // Follow the log only while the user is already at the bottom.
  //
  // This used to jam scrollTop to the end on every log change. A running
  // dispatch polls every 1.5s, so scrolling up to read an earlier line meant
  // being thrown back to the tail a moment later — the log was unreadable
  // until the run finished. Now scrolling up detaches, and scrolling back to
  // the bottom re-attaches, which is how a tail-follow is expected to behave.
  const wasAtBottomRef = useRef(true);
  const onLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    wasAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el && wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [detail?.log]);
  // A different dispatch is a fresh log — start following it again.
  useEffect(() => {
    wasAtBottomRef.current = true;
  }, [selected]);

  // Both of these scan the entire log with regexes, and extractPrInfo was
  // being called twice per render on top of that. A running dispatch renders
  // every 1.5s against a log that reaches 200KB, so key them on the log.
  const log = detail?.log ?? "";
  const prInfo = useMemo(() => extractPrInfo(log), [log]);
  const cost = useMemo(() => extractCost(log), [log]);

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
          Start one from <a href="/trigger" className="text-signal hover:underline">New run</a>, or hit the command palette ({isMac() ? "⌘K" : "Ctrl K"}) and paste a repo URL.
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
                onClick={() => pick(d.id)}
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
                        // "verified" is reserved for a suite that actually
                        // ran and passed. An opened PR whose tests were
                        // skipped or never run says so rather than implying
                        // a green check it didn't earn.
                        d.tests === "passed" ? (
                          <span className="text-ok">✓ PR opened · verified</span>
                        ) : (
                          <span className="text-ok">
                            PR opened{" "}
                            <span
                              className="text-paper-faint"
                              title={
                                d.tests === "skipped"
                                  ? "No recognized test suite in this repo"
                                  : "Tests were not run — see OPENSRCER_RUN_TESTS"
                              }
                            >
                              · unverified
                            </span>
                          </span>
                        )
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
            {/* Header */}
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <IconTrigger className="text-signal" />
                    <a href={detail.repo_url} target="_blank" rel="noreferrer" className="text-[13px] text-paper-muted hover:text-signal truncate">
                      {shortRepo(detail.repo_url)}
                    </a>
                    {detail.issue_number !== undefined && (
                      <a href={`${detail.repo_url.replace(/\/$/, "")}/issues/${detail.issue_number}`} target="_blank" rel="noreferrer" className="text-[12px] text-info hover:text-signal border border-info/40 px-1.5 py-0.5 leading-none">
                        #{detail.issue_number}
                      </a>
                    )}
                  </div>
                  <div className="mt-1.5 text-[17px] text-paper leading-snug truncate">
                    {detail.issue_title ??
                      (detail.issue_number !== undefined
                        ? <span className="italic text-paper-faint">loading title…</span>
                        : <span className="text-paper-muted">Dispatch {detail.id.slice(-8)}</span>)}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-paper-muted">
                    <span className="tabular-nums">{formatAbsoluteOrRelative(detail.started_at)}</span>
                    {detail.ended_at && (
                      <><span className="text-paper-faint">·</span><span className="tabular-nums">{formatDuration(detail.started_at, detail.ended_at)}</span></>
                    )}
                    {cost !== null && (<><span className="text-paper-faint">·</span><span className="tabular-nums text-signal">${cost.toFixed(4)}</span></>)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip tone={detail.status === "running" ? "signal" : detail.pr_status === "opened" ? "ok" : (detail.pr_status === "failed" || detail.pr_status === "tests_failed") ? "alert" : toneFor(detail.status)}>
                    {detail.status === "running" ? "live" : detail.pr_status === "opened" ? "PR opened" : detail.pr_status === "tests_failed" ? "tests failed" : detail.status}
                  </StatusChip>
                  {detail.status === "running" && <CancelButton dispatchId={detail.id} />}
                  <RetryButton dispatch={detail} />
                  {detail.status !== "running" && <ExportButton dispatch={detail} />}
                </div>
              </div>
            </div>

            {/* Pipeline timeline */}
            {detail.log && (
              <div className="border-b border-border px-4 py-2">
                <PipelineTimeline log={detail.log} status={detail.status} />
              </div>
            )}

            {/* Failure banner (compact) */}
            {(detail.pr_status === "failed" || detail.pr_status === "tests_failed") && (
              <div className="border-b border-alert/40 bg-alert/5 px-4 py-2.5 text-[12px] text-alert">
                {detail.pr_status === "tests_failed" ? "Tests failed — PR not opened" : "Auto-PR failed"}
                {detail.pr_failure_reason && <span className="text-paper-muted ml-2">— {detail.pr_failure_reason.slice(0, 120)}</span>}
              </div>
            )}

            {/* PR banner */}
            {(() => {
              const info = prInfo;
              if (!info) return null;
              return (
                <div className="border-b border-ok/40 bg-ok/5 px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[13px] text-ok">PR #{info.prNumber} opened</span>
                  <a href={info.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1.5 border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20 px-3 py-1 text-[12px]">
                    Open on GitHub <IconExternal />
                  </a>
                </div>
              );
            })()}

            {/* Diff preview */}
            <DiffPreviewFromLog log={detail.log} prOpened={!!prInfo} />

            {/* Log */}
            <LogViewer log={detail.log} isRunning={detail.status === "running"} logRef={logRef} onScroll={onLogScroll} />
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

  const showRetry = dispatch.status === "failed" || dispatch.status === "killed" ||
    dispatch.pr_status === "failed" || dispatch.pr_status === "tests_failed";
  if (!showRetry) return null;
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

function LogViewer({ log, isRunning, logRef, onScroll }: { log: string; isRunning: boolean; logRef: React.RefObject<HTMLPreElement | null>; onScroll: () => void }) {
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
      <pre ref={logRef} onScroll={onScroll} className="h-[50vh] overflow-auto p-4 text-[11.5px] leading-relaxed text-paper-dim bg-ink/70 font-mono whitespace-pre-wrap">
        {search.length >= 2 ? renderLog() : rawMode ? <AnsiLog text={log} /> : (clean || "(log empty — waiting for first write)")}
      </pre>
    </div>
  );
}

// ANSI color renderer — converts escape sequences to styled spans.
//
// Values are bare colors, not "color: #xxx" declarations. They used to be the
// latter, spread into a React style object as `{ cssText: "color: #ff5c5c" }`
// — but `cssText` is a DOM CSSStyleDeclaration property, not a React style
// key, so React dropped it with a warning and every span rendered unstyled.
// The "colored" toggle next to the log has therefore never coloured anything.
const ANSI_COLORS: Record<number, string> = {
  30: "#6b6557", 31: "#ff5c5c", 32: "#7fe83f",
  33: "#ff9d2e", 34: "#5ec8ff", 35: "#d898ff",
  36: "#5ec8ff", 37: "#ece5d1",
  90: "#6b6557", 91: "#ff5c5c", 92: "#7fe83f",
  93: "#ffb866", 94: "#5ec8ff", 95: "#d898ff",
  96: "#5ec8ff", 97: "#ece5d1",
};

function AnsiLog({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let color: string | undefined;
  let bold = false;
  let ki = 0;

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      const style: React.CSSProperties | undefined =
        color || bold
          ? { ...(color ? { color } : {}), ...(bold ? { fontWeight: 600 } : {}) }
          : undefined;
      parts.push(
        <span key={ki++} style={style}>
          {text.slice(last, match.index)}
        </span>,
      );
    }
    for (const c of match[1].split(";").map(Number)) {
      if (c === 0) { color = undefined; bold = false; }
      else if (c === 1) bold = true;
      else if (ANSI_COLORS[c]) color = ANSI_COLORS[c];
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

            {/* Split diff */}
            <SplitDiffView body={diff.body} />

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
  // Parsing lives in lib/diff-view.ts so the alignment rule can be tested.
  const hunks = useMemo(() => parseSplitHunks(body), [body]);

  return (
    <div className="max-h-[50vh] overflow-auto">
      {hunks.map((h, hi) => (
        <div key={hi}>
          <div className="px-4 py-1.5 text-[10px] text-paper-muted bg-surface/30 border-b border-border-soft font-mono">
            {h.file}
          </div>
          <div className="grid grid-cols-2 divide-x divide-border-soft">
            <DiffPane lines={h.before} tone="before" />
            <DiffPane lines={h.after} tone="after" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One side of the split view. A `null` row renders as an inert gutter so the
 *  opposite side keeps its vertical position. */
function DiffPane({ lines, tone }: { lines: DiffRow[]; tone: "before" | "after" }) {
  return (
    <pre
      className={cn(
        "p-3 text-[11px] leading-snug font-mono overflow-x-auto",
        tone === "before" ? "bg-alert/5" : "bg-ok/5",
      )}
    >
      {lines.map((l, i) =>
        l === null ? (
          <div key={i} className="whitespace-pre bg-ink/40 select-none" aria-hidden>
            {" "}
          </div>
        ) : (
          <div key={i} className="whitespace-pre text-paper-dim">
            {l || " "}
          </div>
        ),
      )}
    </pre>
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
