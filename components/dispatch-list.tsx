"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { StatusChip, StatusDot } from "./status-dot";
import { IconExternal, IconTrigger } from "./icons";
import { pollJson } from "@/lib/poll-json";
import { cn, formatRelative } from "@/lib/utils";
import { extractFirstDiff, parseSplitHunks, type DiffRow } from "@/lib/diff-view";
import { findGitHubPullUrl } from "@/lib/github-pull-url";
import { PublishPanel } from "./publish-panel";
import { NextSteps } from "./next-steps";
import { Doodle } from "./brand/doodles";
import { loop, spark } from "./brand/doodle-data";


type PrStatus = "opened" | "failed" | "pending" | "tests_passed" | "tests_failed" | "awaiting_review" | "blocked" | "none";

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
  /** Hosted subscription runs: the Claude sign-in this run is waiting on. */
  sign_in?: { url: string; status: "waiting" | "signed_in" | "failed" };
  /** A frozen publish-gate preview exists for this run. */
  has_preview?: boolean;
};

type DispatchWithLog = Dispatch & { log: string };

export function DispatchList() {
  const searchParams = useSearchParams();
  const initialDispatch = searchParams.get("dispatch");
  const [pollError, setPollError] = useState<string | null>(null);
  const [items, setItems] = useState<Dispatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDispatch);
  const [detail, setDetail] = useState<DispatchWithLog | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
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

  // Read the current permission without prompting. Browser permission dialogs
  // should follow an explicit user action, not appear when the page opens.
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotificationPermission(Notification.permission);
  }, []);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    setNotificationPermission(await Notification.requestPermission());
  }

  // Poll dispatch list.
  //
  // Deps are empty on purpose. This used to depend on `selected`, so every
  // click tore the interval down and built a new one — the poll cadence
  // restarted from zero on each selection, and the effect re-ran only to read
  // one value. `selectedRef` gives the loop the current selection without
  // making the subscription depend on it.
  useEffect(() => pollJson<{ dispatches?: Dispatch[] }>("/api/dispatches", ({ data, error }) => {
    setPollError(error);
    if (!data) return;
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
        new Notification(`opensrcer · ${dispatchTarget(d)}`, {
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
  }, 10_000), []);

  // Poll selected dispatch's log incrementally: ask only for bytes written
  // since the last poll and append them. The server used to resend the
  // whole log (up to 200KB) every 1.5s.
  useEffect(() => {
    if (!selected) return;
    let offset = 0;
    setDetail(null);
    setDetailError(null);
    return pollJson<DispatchWithLog & { log_size?: number; log_reset?: boolean }>(
      () => `/api/dispatches/${selected}?since=${offset}`,
      ({ data, error, status }) => {
        if (!data) {
          setDetailError(status === 404 ? "This run no longer exists, or it belongs to another account." : error);
          return;
        }
        setDetailError(null);
        const chunk = typeof data.log === "string" ? data.log : "";
        offset = data.log_size ?? 0;
        setDetail((prev) => {
          if (data.log_reset || !prev || prev.id !== data.id) return { ...data, log: chunk };
          // A PR this page just published stays shown even if a poll answered first.
          const keepPublished = !data.pr_url && prev.pr_url;
          return { ...data, log: prev.log + chunk, ...(keepPublished ? { pr_url: prev.pr_url, pr_status: prev.pr_status } : {}) };
        });
        // A finished run whose log has been read to the end has nothing more to show.
        return !(data.status !== "running" && data.pr_status !== "pending" && chunk === "");
      }, 1500,
    );
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
  const prInfo = useMemo(() => extractPrInfo(detail?.pr_url), [detail?.pr_url]);
  const cost = useMemo(() => extractCost(log), [log]);

  // #10: Loading skeleton
  if (items === null) {
    return (
      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-5 lg:col-span-4">
          <div className="ruled">
            {[1, 2, 3].map((i) => (
              <div key={i} className="py-4 space-y-2">
                <div className="h-3 w-3/4 rounded-full bg-surface-3 animate-pulse" />
                <div className="h-2.5 w-1/2 rounded-full bg-surface-2 animate-pulse" />
                <div className="h-2 w-1/3 rounded-full bg-surface-2 animate-pulse" />
              </div>
            ))}
          </div>
        </aside>
        <section className="col-span-12 md:col-span-7 lg:col-span-8">
          <div role="status" className="card p-10 text-center text-[14px] text-paper-muted">
            {pollError ? `Could not load runs: ${pollError} Retrying...` : "Loading runs..."}
          </div>
        </section>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="card relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
        <h2 className="display text-[36px] leading-none text-paper sm:text-[48px]">No runs yet</h2>
        <p className="mt-4 max-w-md text-[16px] leading-[1.6] text-paper-muted">
          Start with a GitHub repository or issue. Preview mode lets you inspect the proposed patch before anything is published.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/trigger" className="btn-primary">
            Start a run
          </Link>
          <Link href="/issues" className="text-link">
            Browse issues
          </Link>
        </div>
        {/* A hand-drawn loop in the corner of an empty page: the one personal mark here. */}
        <Doodle doodle={loop} draw="load" delay={200} className="doodle-thin pointer-events-none absolute bottom-8 right-10 hidden h-28 w-40 sm:block" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {pollError && <p role="status" className="col-span-12 text-[14px] text-alert">Could not refresh runs: {pollError} Retrying...</p>}
      {/* List */}
      <aside className="col-span-12 md:col-span-5 lg:col-span-4">
        <div>
          <div className="list-head mb-2 items-center">
            <div>
              <h2 className="inline text-[15px] font-semibold text-paper">Your runs</h2>
              <span className="ml-2 font-mono text-[12px] text-paper-faint tabular-nums" aria-label={`${items.length} runs`}>
                {items.length}
              </span>
            </div>
            {notificationPermission === "default" && (
              <button type="button" onClick={enableNotifications} className="text-link text-[13.5px]">
                Enable notifications
              </button>
            )}
          </div>
          {/* Ruled rows; the open run keeps its sheet of lighter paper. The
              scroll box pads 16px so the hover sheet's bleed isn't clipped. */}
          <ul className="ruled -mx-4 max-h-[70vh] overflow-y-auto px-4">
            {items.map((d) => (
              <li
                key={d.id}
                data-open={selected === d.id ? "" : undefined}
              >
                {/* A real link, so keyboard and screen-reader users can open a run;
                    a plain click still selects in place without navigating. */}
                <a
                  href={`/dispatches?dispatch=${encodeURIComponent(d.id)}`}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    pick(d.id);
                  }}
                  aria-current={selected === d.id ? "true" : undefined}
                  className="block py-4 focus-visible:outline-offset-[-3px]"
                >
                  <div className="flex items-baseline gap-2">
                    <StatusDot tone={toneFor(d.status)} className="-translate-y-0.5" />
                    {/* Cloud runs do not fetch titles, so keep the issue number
                        visible until the local title cache fills it in. */}
                    <span className="min-w-0 truncate text-[15.5px] font-semibold text-paper">
                      {d.issue_number !== undefined ? (d.issue_title ?? `Issue #${d.issue_number}`) : dispatchTarget(d)}
                    </span>
                    {d.dry_run && (
                      <span title="Preview: a practice run that can't be published" className="chip ml-auto text-[12.5px]" data-tone="info">
                        preview
                      </span>
                    )}
                  </div>
                  <div className="meta mt-1 pl-3.5">
                    {d.issue_number !== undefined && <span>{dispatchTarget(d)} #{d.issue_number}</span>}
                    <span title={d.started_at}>
                      {formatAbsoluteOrRelative(d.started_at)}
                    </span>
                    {/* #2: Duration display */}
                    {d.ended_at && <span>{formatDuration(d.started_at, d.ended_at)}</span>}
                    {d.status === "running" && <span className="text-paper">{formatDuration(d.started_at)}</span>}
                    <span>
                      {d.status === "succeeded" && d.pr_status === "tests_failed" ? (
                        <span className="text-alert">tests failed</span>
                      ) : d.status === "succeeded" && d.pr_status === "tests_passed" ? (
                        <span className="text-ok">✓ verified</span>
                      ) : d.status === "succeeded" && d.pr_status === "failed" ? (
                        <span className="text-alert">PR failed</span>
                      ) : d.status === "succeeded" && d.pr_status === "pending" ? (
                        <span className="text-paper">opening PR</span>
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
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Detail */}
      <section className="col-span-12 md:col-span-7 lg:col-span-8">
        {detail ? (
          <div className="card overflow-hidden">
            {/* Header */}
            <div className="border-b border-border-soft px-5 py-5 sm:px-8 sm:py-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-[12rem] flex-1">
                  <div className="flex items-center gap-2">
                    <IconTrigger className="text-signal" />
                    {detail.repo_url ? (
                      <a href={repoHref(detail.repo_url)} target="_blank" rel="noreferrer" className="text-[15px] font-medium text-paper-dim hover:text-signal truncate">
                        {dispatchTarget(detail)}
                      </a>
                    ) : <span className="text-[13px] text-paper-muted">{dispatchTarget(detail)}</span>}
                    {detail.repo_url && detail.issue_number !== undefined && (
                      <a href={`${repoHref(detail.repo_url)}/issues/${detail.issue_number}`} target="_blank" rel="noreferrer" className="chip hover:underline" data-tone="info">
                        #{detail.issue_number}
                      </a>
                    )}
                  </div>
                  <div className="display mt-2 text-[26px] leading-[1.05] text-paper sm:text-[30px]">
                    {detail.issue_title ??
                      (detail.issue_number !== undefined
                        ? `Issue #${detail.issue_number}`
                        : <span className="text-paper-muted">Dispatch {detail.id.slice(-8)}</span>)}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-paper-muted">
                    <span className="tabular-nums">{formatAbsoluteOrRelative(detail.started_at)}</span>
                    {detail.ended_at && (
                      <><span className="text-paper-faint">·</span><span className="tabular-nums">{formatDuration(detail.started_at, detail.ended_at)}</span></>
                    )}
                    {cost !== null && (<><span className="text-paper-faint">·</span><span className="tabular-nums text-signal">${cost.toFixed(4)}</span></>)}
                    {/* For support requests; also in the downloaded report. */}
                    <span className="text-paper-faint">·</span>
                    <span className="break-all">Run ID (for support): <span className="select-all font-mono">{detail.id}</span></span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={detail.status === "running" ? "signal" : detail.pr_status === "opened" ? "ok" : (detail.pr_status === "failed" || detail.pr_status === "tests_failed") ? "alert" : toneFor(detail.status)}>
                    {detail.status === "running" ? "live" : detail.pr_status === "opened" ? "PR opened" : detail.pr_status === "tests_failed" ? "tests failed" : detail.pr_status === "awaiting_review" ? "waiting for your review" : detail.pr_status === "blocked" ? "blocked" : detail.status}
                  </StatusChip>
                  {detail.status === "running" && <CancelButton dispatchId={detail.id} />}
                  <RetryButton dispatch={detail} />
                  {detail.status !== "running" && <ExportButton dispatch={detail} />}
                </div>
              </div>
            </div>

            {/* Pipeline timeline */}
            {detail.log && (
              <div className="border-b border-border-soft px-5 py-3 sm:px-8">
                <PipelineTimeline log={detail.log} status={detail.status} prUrl={detail.pr_url} />
              </div>
            )}

            {detail.status === "running" && detail.sign_in?.status === "waiting" && (
              <SignInPanel dispatchId={detail.id} url={detail.sign_in.url} />
            )}

            {/* Failure banner (compact) */}
            {(detail.pr_status === "failed" || detail.pr_status === "tests_failed") && (
              <div className="border-b border-border-soft bg-alert-dim/30 px-5 py-3 text-[15px] font-medium text-alert sm:px-8">
                {detail.pr_status === "tests_failed" ? "Tests failed — PR not opened" : "Publishing failed"}
                {detail.pr_failure_reason && <span className="ml-2 font-normal text-paper-dim">— {detail.pr_failure_reason.slice(0, 120)}</span>}
              </div>
            )}

            {/* Publish gate: review the frozen preview, confirm, then publish. */}
            {detail.status !== "running" && detail.has_preview && !prInfo && (
              <PublishPanel
                dispatchId={detail.id}
                repo={detail.repo_url ?? undefined}
                dryRun={detail.dry_run}
                rerun={detail.dry_run && detail.repo_url && detail.issue_number ? { repoUrl: detail.repo_url, issue: detail.issue_number } : undefined}
                // The run's poll has stopped by now, so show the new PR here directly.
                onPublished={(url) => {
                  setDetail((d) => (d && d.id === detail.id ? { ...d, pr_url: url, pr_status: "opened" } : d));
                  // The Publish button just disappeared; keep keyboard and screen-reader focus on the result.
                  setTimeout(() => document.getElementById("pr-opened")?.focus(), 0);
                }}
              />
            )}

            {/* PR banner */}
            {(() => {
              const info = prInfo;
              if (!info) return null;
              return (
                <div className="border-b border-border-soft bg-ok-dim/25 px-5 py-7 sm:px-8 sm:py-9">
                  <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-4">
                    {/* The success moment: a small hand-drawn spark beside the result. */}
                    <span className="inline-flex items-center gap-3">
                      <Doodle doodle={spark} draw="load" className="doodle-thin h-8 w-8 shrink-0" />
                      <span id="pr-opened" tabIndex={-1} className="display text-[28px] leading-none text-ok outline-none sm:text-[34px]">Draft PR #{info.prNumber} opened</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                      <Link href={`/prs/${info.repoFull}/${info.prNumber}`} className="btn-primary" data-size="sm">
                        Follow it here
                      </Link>
                      <a href={info.url} target="_blank" rel="noreferrer" className="text-link text-[14px]">
                        Open on GitHub
                      </a>
                    </span>
                  </div>
                  <div className="mt-6 border-t border-ok/20 pt-6"><NextSteps /></div>
                </div>
              );
            })()}

            {/* Diff preview */}
            <DiffPreviewFromLog log={detail.log} prOpened={!!prInfo} prUrl={detail.pr_url} dryRun={detail.dry_run} />

            {/* Log */}
            <LogViewer log={detail.log} isRunning={detail.status === "running"} logRef={logRef} onScroll={onLogScroll} />
          </div>
        ) : selected && detailError ? (
          <div role="alert" className="callout p-10 text-center text-[14px]" data-tone="alert">
            {detailError}
          </div>
        ) : (
          <div className="card p-10 text-center text-[14px] text-paper-muted">
            Select a run to view its log.
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
  if (!dispatch.issue_number || !dispatch.repo_url) return null;

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
          dry_run: dispatch.dry_run,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = (await res.json().catch(() => ({}))) as { dispatch_id?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Could not restart this run.");
      if (typeof json.dispatch_id !== "string" || !json.dispatch_id.trim()) {
        throw new Error("The server returned an invalid run response. Please try again.");
      }
      window.location.href = `/dispatches?dispatch=${encodeURIComponent(json.dispatch_id)}`;
    } catch (e) {
      setError(e instanceof Error && e.name === "TimeoutError"
        ? "Restarting the run timed out. Please try again."
        : e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={retry}
        disabled={pending}
        className="btn-quiet"
        data-size="sm"
      >
        {pending ? "retrying…" : "retry"}
      </button>
      {error && <span role="alert" className="text-[12.5px] text-alert">{error}</span>}
    </div>
  );
}

// Hosted subscription run waiting for the user to sign in to Claude. The link
// is Anthropic's own sign-in page (validated server-side); the code it shows
// is sent once to this run's worker and not kept anywhere.
function SignInPanel({ dispatchId, url }: { dispatchId: string; url: string }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/dispatches/${dispatchId}/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not send the code.");
      setCode("");
      setMessage({ text: "Code sent. The run starts once Claude confirms the sign-in.", ok: true });
    } catch (cause) {
      setMessage({ text: cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Sending the code timed out. Try again.", ok: false });
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-labelledby={`sign-in-${dispatchId}`} className="border-b border-border-soft bg-signal-faint/70 px-5 py-5 text-[14px] sm:px-8">
      <h3 id={`sign-in-${dispatchId}`} className="text-[16px] font-semibold text-signal">Sign in to Claude to start this run</h3>
      <p className="mt-1 text-paper-muted">
        This run uses your own Claude subscription. Sign in on Claude&apos;s page, then paste the code it shows you here.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="text-link">
          Open Claude sign-in
        </a>
        <label htmlFor={`sign-in-code-${dispatchId}`} className="sr-only">Sign-in code</label>
        <input
          id={`sign-in-code-${dispatchId}`}
          type="password"
          maxLength={1024}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste code"
          autoComplete="off"
          spellCheck={false}
          className="field min-w-0 flex-1 basis-48"
        />
        <button type="submit" disabled={pending || !code.trim()} className="btn-primary">
          {pending ? "Sending…" : "Send code"}
        </button>
      </form>
      {message && <p role="status" className={`mt-2 text-[13px] ${message.ok ? "text-ok" : "text-alert"}`}>{message.text}</p>}
    </section>
  );
}

function CancelButton({ dispatchId }: { dispatchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/dispatches/${dispatchId}/cancel`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not stop this run.");
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The stop request timed out. Try again.");
    } finally {
      setPending(false);
    }
  }
  if (confirming) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={cancel}
          disabled={pending}
          className="btn-quiet"
          data-size="sm"
          data-tone="alert"
        >
          {pending ? "…" : "confirm kill"}
        </button>
        <button
          onClick={() => { setConfirming(false); setError(null); }}
          className="min-h-10 px-2 text-[13px] text-paper-muted hover:text-paper sm:min-h-8"
        >
          cancel
        </button>
        {error && <span role="alert" className="basis-full text-[12.5px] text-alert">{error}</span>}
      </span>
    );
  }
  return (
    <button
      onClick={() => { setConfirming(true); setError(null); }}
      className="btn-quiet"
      data-size="sm"
      data-tone="alert"
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
        ? <mark key={i} className="rounded-sm bg-[#ffd60a] text-[#1d1d1f]">{part}</mark>
        : part
    );
  }

  // A toolbar above the log, not floating over it, so no log line is hidden.
  const tool = "inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_var(--color-border)] transition sm:min-h-8";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border-soft px-5 py-3 sm:px-8">
        <span className="kicker mr-auto text-paper-muted">Agent log</span>
        {isRunning && !showSearch && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-signal">
            <StatusDot tone="signal" /> streaming
          </span>
        )}
        {showSearch && (
          <>
            <input
              ref={searchRef}
              type="search"
              aria-label="Search the log"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the log…"
              className="field min-h-10 w-48 py-1 text-[13px] sm:min-h-8"
            />
            {search.length >= 2 && (
              <span className="text-[12.5px] text-paper-muted tabular-nums" aria-live="polite">{matchCount} match{matchCount === 1 ? "" : "es"}</span>
            )}
            <button type="button" onClick={() => { setShowSearch(false); setSearch(""); }} className={cn(tool, "text-paper-dim hover:text-paper")}>
              Close search
            </button>
          </>
        )}
        {!showSearch && !isRunning && (
          <>
            <button
              type="button"
              onClick={() => setRawMode(!rawMode)}
              aria-pressed={rawMode}
              className={cn(tool, rawMode ? "bg-paper text-ink shadow-none" : "text-paper-dim hover:text-paper")}
            >
              Show terminal colors
            </button>
            <button
              type="button"
              onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 50); }}
              aria-keyshortcuts="Control+F"
              className={cn(tool, "text-paper-dim hover:text-signal")}
            >
              <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4" /><path d="m13 13-3.5-3.5" /></svg>
              Search log
            </button>
          </>
        )}
      </div>
      <pre ref={logRef} onScroll={onScroll} tabIndex={0} aria-label="Run log" className="term h-[50vh] overflow-auto rounded-none p-5 text-[12px] leading-relaxed font-mono whitespace-pre-wrap sm:px-8">
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
    const repo = dispatchTarget(dispatch);
    const prInfo = extractPrInfo(dispatch.pr_url);
    const diff = diffStats(dispatch.log);
    const costMatch = /total_cost_usd=([\d.]+)/.exec(dispatch.log);
    const cost = costMatch ? parseFloat(costMatch[1]) : null;

    const parts = [
      `# Dispatch Report`,
      ``,
      `- **Run ID:** ${dispatch.id}`,
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
      className="text-link text-[14px]"
      title="Saves the run's details, patch and full log as a Markdown file"
    >
      Download report
    </button>
  );
}

function PipelineTimeline({ log, status, prUrl }: { log: string; status: string; prUrl?: string }) {
  const hasPullRequest = Boolean(extractPrInfo(prUrl));
  const phases = [
    { label: "clone", done: log.includes("[agentic-dispatcher] repo:"), active: status === "running" && !/grep|read_file|find_definition/.test(log), failed: false },
    { label: "explore", done: /find_definition|read_file|grep|list_files|repo_info/.test(log), active: status === "running" && /find_definition|read_file|grep/.test(log) && !/```diff/.test(log), failed: false },
    { label: "patch", done: /```(?:diff|patch)/.test(log), active: status === "running" && /## Diagnosis/.test(log) && !/```diff/.test(log), failed: status !== "running" && !/```(?:diff|patch)/.test(log) && /exited at/.test(log) },
    { label: "test", done: /\[crucible-tests\]/.test(log), active: /\[agentic-pr\] starting/.test(log) && !/\[crucible-tests\]/.test(log), failed: /\[crucible-tests\] status=(?:failed|error)/.test(log) },
    { label: "PR", done: hasPullRequest, active: /\[agentic-pr\] starting/.test(log) && !hasPullRequest && !/skipped:/.test(log), failed: /\[agentic-pr\] skipped:/.test(log) },
  ];

  return (
    // Wraps as whole steps on narrow screens; a step's mark and name never split.
    // Phones drop the connector lines, which would otherwise start a wrapped row.
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 sm:gap-x-1">
      {phases.map((p, i) => (
        <div key={p.label} className="flex items-center gap-1">
          {i > 0 && <div className={cn("w-4 h-px max-sm:hidden", p.done || p.active ? "bg-ok/40" : "bg-border")} />}
          <span
            className={cn(
              "flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none",
              p.failed ? "bg-alert-dim/60 text-alert" :
              p.done ? "bg-ok-dim/60 text-ok" :
              p.active ? "bg-signal-faint text-signal" :
              "bg-surface-2 text-paper-muted",
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

function dispatchTarget(dispatch: Pick<Dispatch, "repo_url" | "mode">) {
  return dispatch.repo_url ? shortRepo(dispatch.repo_url) : dispatch.mode === "hunt" ? "Repository discovery" : "Unknown repository";
}

function repoHref(url: string) {
  const repo = shortRepo(url).replace(/^\/+|\/+$/g, "");
  return `https://github.com/${repo}`;
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

// The same extraction the worker applies (lib/diff-view.ts), plus counts.
function diffStats(log: string): DiffStats | null {
  const body = log ? extractFirstDiff(log) : null;
  if (!body) return null;
  const files = [...body.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((x) => x[1]).filter((f) => f !== "/dev/null");
  let adds = 0, dels = 0;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) adds++;
    else if (line.startsWith("-")) dels++;
  }
  return { files, additions: adds, deletions: dels, body };
}

// Lightweight markdown→JSX for Claude's summary sections. Handles bold,
// inline code, bullets, numbered lists, and paragraphs — enough for the
// structured output Claude produces without a heavy lib.
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5 text-[14px] text-paper-dim leading-relaxed">
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
        <code key={ki++} className="rounded bg-signal-faint px-1 py-0.5 font-mono text-[12px] text-signal">
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

function DiffPreviewFromLog({ log, prOpened, prUrl, dryRun }: { log: string; prOpened: boolean; prUrl?: string; dryRun: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // A real modal: focus moves in, Tab stays in, Escape closes, focus returns to the opener.
  useEffect(() => {
    if (!modalOpen) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setModalOpen(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex=\"0\"]"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    const opener = openerRef.current;
    return () => { window.removeEventListener("keydown", onKeyDown); opener?.focus(); };
  }, [modalOpen]);

  const diff = diffStats(log);
  if (!diff) return null;

  const diagnosis = extractLogSection(log, "Diagnosis|Analysis|Root cause|Problem");
  const risk = extractLogSection(log, "Risk\\s*/\\s*Test|Risk / test|Risk and test|Testing|Test notes");
  const prTitle = extractLogSection(log, "PR title|Suggested PR title|Title");
  const prInfo = extractPrInfo(prUrl);

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
      <div className="border-t border-border-soft">
        <button
          ref={openerRef}
          onClick={() => setModalOpen(true)}
          className="group w-full px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-ink-2 transition-colors sm:px-8"
        >
          <span className="text-[16px] text-paper font-semibold">Review patch</span>
          <span className="text-[12.5px] text-paper-muted tabular-nums">
            {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
          </span>
          <span className="font-mono text-[12.5px] text-ok tabular-nums">+{diff.additions}</span>
          <span className="font-mono text-[12.5px] text-alert tabular-nums">-{diff.deletions}</span>
          <span className="ml-auto text-[13px] font-medium text-signal group-hover:underline">
            open review →
          </span>
        </button>
      </div>

      {/* Full-screen modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-paper/45 overflow-y-auto py-8 px-4">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Proposed patch" className="card w-full max-w-4xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-border-soft sm:px-8">
              <div>
                <div className="display text-[24px] leading-tight text-paper">
                  {prTitle?.split("\n")[0]?.replace(/^[#>*\-`\s]+/, "") || "Proposed patch"}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[12.5px] text-paper-muted">
                  <span>{diff.files.length} file{diff.files.length === 1 ? "" : "s"} changed</span>
                  <span className="text-ok">+{diff.additions} additions</span>
                  <span className="text-alert">-{diff.deletions} deletions</span>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="grid size-10 shrink-0 place-items-center rounded-full text-[20px] text-paper-muted hover:bg-surface-2 hover:text-paper"
                title="Close"
                aria-label="Close patch"
              >
                ×
              </button>
            </div>

            {/* Diagnosis + Risk summary */}
            {(diagnosis || risk) && (
              <div className="px-6 py-6 border-b border-border-soft space-y-6 sm:px-8">
                {diagnosis && (
                  <div>
                    <div className="kicker text-paper-muted mb-2">What was found</div>
                    <Markdown text={diagnosis} />
                  </div>
                )}
                {risk && (
                  <div>
                    <div className="kicker text-paper-muted mb-2">Risk &amp; testing</div>
                    <Markdown text={risk} />
                  </div>
                )}
              </div>
            )}

            {/* File list */}
            <div className="px-6 py-3 border-b border-border-soft bg-ink-2 flex items-center gap-2 text-[12.5px] text-paper-muted flex-wrap sm:px-8">
              <span className="font-medium text-paper-dim">Files:</span>
              {diff.files.map((f) => (
                <code key={f} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-paper-dim">{f}</code>
              ))}
            </div>

            {/* Split diff */}
            <SplitDiffView body={diff.body} />

            {/* Actions */}
            <div className="px-6 py-4 border-t border-border-soft flex items-center justify-between gap-4 flex-wrap sm:px-8">
              <div className="flex items-center gap-3">
                <button
                  onClick={copyDiff}
                  className="btn-quiet"
                  data-size="sm"
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
                  className="min-h-10 px-3 text-[13px] text-paper-muted hover:text-paper transition sm:min-h-9"
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
                    className="btn-primary"
                    data-size="sm"
                  >
                    View PR #{prInfo.prNumber}
                    <IconExternal />
                  </a>
                ) : prOpened ? null : (
                  <span className="text-[12.5px] text-paper-muted">
                    {dryRun ? "Preview only: no code will be pushed and no PR will open." : "Nothing is posted until you publish it from the run page."}
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
      className="btn-quiet"
      data-size="sm"
    >
      {copied ? "Copied ✓" : "Commit msg"}
    </button>
  );
}

function SplitDiffView({ body }: { body: string }) {
  // Parsing lives in lib/diff-view.ts so the alignment rule can be tested.
  const hunks = useMemo(() => parseSplitHunks(body), [body]);

  return (
    <div tabIndex={0} role="region" aria-label="Patch" className="max-h-[50vh] overflow-auto">
      {hunks.map((h, hi) => (
        <div key={hi}>
          <div className="px-6 py-2 text-[12px] text-paper-muted bg-ink-2 border-b border-border-soft font-mono sm:px-8">
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
        "p-3 text-[12px] leading-snug font-mono overflow-x-auto",
        tone === "before" ? "bg-alert-dim/20" : "bg-ok-dim/25",
      )}
    >
      {lines.map((l, i) =>
        l === null ? (
          <div key={i} className="whitespace-pre bg-surface-2/60 select-none" aria-hidden>
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

// Only the run record's pr_url, which the server sets when it opens the PR.
// The log can't be trusted for this: model output is written into it, so an
// injected issue could print a "PR opened" line pointing at any PR.
function extractPrInfo(prUrl: string | undefined): PrInfo | null {
  return prUrl ? findGitHubPullUrl(prUrl) : null;
}
