"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { InterestRequest, InterestStatus } from "@/lib/interest";

type Filter = "all" | InterestStatus;
const FILTERS: Array<[Filter, string]> = [["new", "New"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];
const TONE: Record<InterestStatus, string> = { new: "text-info", approved: "text-ok", declined: "text-paper-muted" };

/** The admin list of early-access requests: filter, approve, decline, remove, export. */
export function AdminAccess() {
  const [requests, setRequests] = useState<InterestRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/interest", { cache: "no-store" });
      const body = (await res.json()) as { requests?: InterestRequest[]; error?: string };
      if (!res.ok || !body.requests) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRequests(body.requests);
      setError(null);
    } catch (e) {
      setError(`Couldn't load requests: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, method: "PATCH" | "DELETE", status?: InterestStatus) {
    setBusy(id);
    setConfirming(null);
    try {
      const res = await fetch("/api/admin/interest", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const count = (f: Filter) => (requests ?? []).filter((r) => f === "all" || r.status === f).length;
  const shown = (requests ?? []).filter((r) => filter === "all" || r.status === filter);

  async function copyEmails() {
    await navigator.clipboard.writeText(shown.map((r) => r.email).join(", "));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft pb-3">
        <div role="tablist" aria-label="Filter requests" className="flex flex-wrap gap-1">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={cn("min-h-10 rounded-full px-3.5 text-[14px]", filter === f ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}>
              {label} <span className="font-mono text-[12.5px] opacity-70">{requests ? count(f) : "·"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[14px]">
          <button type="button" onClick={() => void load()} className="text-link">Refresh</button>
          <button type="button" onClick={() => void copyEmails()} disabled={!shown.length} className="text-link disabled:opacity-50">{copied ? "Copied" : "Copy emails"}</button>
          <a href="/api/admin/interest?format=csv" className="text-link">Download CSV</a>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-[15px] text-alert">{error}</p>}
      {!requests && !error && <p className="mt-6 text-[15px] text-paper-muted">Loading…</p>}
      {requests && !shown.length && <p className="mt-6 text-[15px] text-paper-muted">{filter === "new" ? "No new requests." : "Nothing here."} The form is at /join.</p>}

      <ul className="divide-y divide-border-soft">
        {shown.map((r) => (
          <li key={r.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-[16px] font-medium text-paper">
                {r.name} <span className={cn("chip ml-2 align-middle", TONE[r.status])}>{r.status}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-4 text-[14px] text-paper-dim">
                <a href={`mailto:${r.email}`} className="text-link break-all">{r.email}</a>
                <a href={`https://github.com/${r.github}`} target="_blank" rel="noreferrer" className="text-link">@{r.github}</a>
                <span className="text-paper-muted">{new Date(r.createdAt).toLocaleString()}</span>
                {r.githubId === null && <span className="text-paper-muted">GitHub id looked up on approval</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.status !== "approved" && <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, "PATCH", "approved")} className="btn-primary inline-flex min-h-10 items-center px-4 text-[14px] disabled:opacity-60">Approve</button>}
              {r.status !== "declined" && <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, "PATCH", r.status === "approved" ? "new" : "declined")} className="inline-flex min-h-10 items-center rounded-[10px] border border-border px-4 text-[14px] text-paper disabled:opacity-60">{r.status === "approved" ? "Revoke" : "Decline"}</button>}
              {confirming === r.id
                ? <button type="button" disabled={busy === r.id} onClick={() => void act(r.id, "DELETE")} className="inline-flex min-h-10 items-center rounded-[10px] border border-alert/40 px-4 text-[14px] text-alert">Confirm remove</button>
                : <button type="button" disabled={busy === r.id} onClick={() => setConfirming(r.id)} className="inline-flex min-h-10 items-center px-2 text-[14px] text-paper-muted hover:text-paper">Remove</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
