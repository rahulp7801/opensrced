"use client";

// The PR follow-up loop on the PR page (lib/pr-followups.ts): what happened
// on the PR since opensrcer opened it, the per-PR opt-in, and the two actions
// that start a follow-up run. Runs end at the usual review step; nothing is
// pushed or posted from here. Renders nothing for PRs opensrcer did not open.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Event = { kind: string; at: string; author?: string; body?: string; url?: string; path?: string; line?: number; changes_requested?: boolean; checks?: Array<{ name: string; url: string }> };
type View = {
  followups: boolean;
  state: "open" | "closed" | "merged";
  ci: "failed" | "passed" | "pending" | "none";
  mergeable_state: string | null;
  linked_issue: number;
  recent: Event[];
  pending_replies: number;
  can_fix_ci: boolean;
  can_address_review: boolean;
};

const LABEL: Record<string, string> = {
  ci_failed: "CI failed", ci_passed: "CI passed", comment: "Review comment", conflict: "Merge conflict", merged: "Merged", closed: "Closed",
};

function detail(e: Event): string {
  if (e.kind === "ci_failed") return (e.checks ?? []).map((c) => c.name).join(", ");
  if (e.kind === "comment") return `${e.author ?? "someone"}${e.changes_requested ? " requested changes" : ""}${e.path ? ` on ${e.path}${e.line ? `:${e.line}` : ""}` : ""}: ${(e.body ?? "").replace(/\s+/g, " ").slice(0, 160)}`;
  if (e.kind === "conflict") return "the branch no longer merges cleanly; rebase it by hand or with the poller";
  return "";
}

export function PrFollowups({ prUrl }: { prUrl: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"optin" | "ci" | "review" | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch(`/api/prs/lifecycle?pr_url=${encodeURIComponent(prUrl)}`, { signal });
    if (r.status === 404) { setView(null); return; } // not an opensrcer PR of this user
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? "Could not load follow-ups.");
    // A malformed answer must not take the PR page down with it.
    if (typeof data?.followups !== "boolean" || typeof data.state !== "string" || !Array.isArray(data.recent)) throw new Error("Could not load follow-ups.");
    setView(data as View);
  }, [prUrl]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load follow-ups."); });
    return () => controller.abort();
  }, [load]);

  if (!view) return error ? <p role="alert" className="mt-3 text-[11px] text-alert">{error}</p> : null;

  async function optIn(enabled: boolean) {
    setBusy("optin");
    setError(null);
    try {
      const r = await fetch("/api/prs/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pr_url: prUrl, followups: enabled }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not save.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  async function start(kind: "ci" | "review") {
    setBusy(kind);
    setError(null);
    try {
      const r = await fetch("/api/prs/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pr_url: prUrl, kind }), signal: AbortSignal.timeout(300_000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.run_url) throw new Error(data.error ?? "Could not start the follow-up run.");
      setStarted(data.run_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the follow-up run.");
    } finally {
      setBusy(null);
    }
  }

  const events = [...view.recent].reverse();
  const open = view.state === "open";
  return (
    <section aria-label="Follow-ups" className="rounded-2xl mt-4 border border-border-soft bg-surface px-4 py-3 text-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-medium text-paper">Follow-ups</h2>
        <span className="text-[11px] text-paper-muted">
          CI: {view.ci === "none" ? "no checks" : view.ci}{view.mergeable_state === "dirty" ? " · merge conflict" : ""}{view.state !== "open" ? ` · ${view.state}` : ""}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="mt-1 text-paper-muted">Nothing new on this PR since opensrcer opened it.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {events.slice(0, 10).map((e, i) => (
            <li key={`${e.kind}-${e.at}-${i}`} className="text-paper-muted">
              <span className={e.kind === "ci_failed" || e.kind === "conflict" ? "text-alert" : e.kind === "ci_passed" || e.kind === "merged" ? "text-ok" : "text-paper"}>{LABEL[e.kind] ?? e.kind}</span>
              {detail(e) && <> · {detail(e)}</>}
              {e.url && <> · <a href={e.url} target="_blank" rel="noopener" className="text-signal hover:underline">view</a></>}
            </li>
          ))}
        </ul>
      )}
      {view.pending_replies > 0 && (
        <p className="mt-2 text-paper-muted">{view.pending_replies} comment{view.pending_replies === 1 ? "" : "s"} may need a reply. Draft replies below; nothing is posted until you send it.</p>
      )}
      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-paper">
            <input type="checkbox" checked={view.followups} disabled={busy !== null} onChange={(e) => void optIn(e.target.checked)} className="h-6 w-6 shrink-0" />
            Help me with follow-ups
          </label>
          {view.followups && (
            <>
              <button onClick={() => void start("ci")} disabled={!view.can_fix_ci || busy !== null}
                className="rounded-full border border-signal/50 bg-signal/10 px-3 py-1 text-[12px] text-signal hover:bg-signal/20 disabled:opacity-50">
                {busy === "ci" ? "starting…" : "Fix CI failure"}
              </button>
              <button onClick={() => void start("review")} disabled={!view.can_address_review || busy !== null}
                className="rounded-full border border-signal/50 bg-signal/10 px-3 py-1 text-[12px] text-signal hover:bg-signal/20 disabled:opacity-50">
                {busy === "review" ? "starting…" : "Address review"}
              </button>
            </>
          )}
        </div>
      )}
      {open && view.followups && (
        <p className="mt-2 text-[11px] text-paper-muted">
          A follow-up starts an agent run on this PR&apos;s branch{view.linked_issue ? ` (issue #${view.linked_issue})` : ""}. It ends at the usual review step:
          nothing is pushed until you confirm it on the run page, and it adds one commit to this PR.
          {!view.linked_issue && " This PR's description names no issue (\"Fixes #N\"), so follow-ups cannot start."}
        </p>
      )}
      {started && <p className="mt-2 text-ok">Follow-up run started. <Link href={started} className="text-signal hover:underline">Open the run</Link></p>}
      {error && <p role="alert" className="mt-2 text-alert">{error}</p>}
    </section>
  );
}
