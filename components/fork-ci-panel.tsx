"use client";

// Fork CI on the run page (lib/fork-ci.ts): after the PR is opened, run the
// project's own GitHub Actions on the same branch inside the user's fork and
// show the verdict. Renders nothing while the feature is off (the route
// answers 404). The one-time "Enable Actions on your fork" link appears only
// when GitHub has paused workflows on the fork.

import { useCallback, useEffect, useState } from "react";
import type { ForkCiRecord } from "@/lib/fork-ci";

const POLL_MS = 20_000;

const TONE: Partial<Record<ForkCiRecord["status"], string>> = {
  passed: "text-ok", failed: "text-alert", timeout: "text-alert",
};

export function ForkCiPanel({ dispatchId }: { dispatchId: string }) {
  // undefined: loading; null: never started.
  const [record, setRecord] = useState<ForkCiRecord | null | undefined>(undefined);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch(`/api/dispatches/${dispatchId}/fork-ci`, { signal });
    if (r.status === 404) { setHidden(true); return; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? "Could not read CI in your fork.");
    setRecord(data.fork_ci ?? null);
  }, [dispatchId]);

  const loading = record === undefined;
  const status = record?.status;
  useEffect(() => {
    const controller = new AbortController();
    const fail = (e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not read CI in your fork."); };
    // First load, then poll only while the fork's CI is running.
    if (loading) load(controller.signal).catch(fail);
    const timer = status === "running" ? setTimeout(() => load(controller.signal).catch(fail), POLL_MS) : undefined;
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load, loading, status, record?.updated_at]);

  if (hidden) return null;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/dispatches/${dispatchId}/fork-ci`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.fork_ci) throw new Error(data.error ?? "Could not start CI in your fork.");
      setRecord(data.fork_ci);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start CI in your fork.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="CI in your fork" className="card mt-4 px-5 py-5 text-[15px] sm:px-6">
      <h2 className="text-[17px] font-semibold text-paper">The project&apos;s own CI, in your fork</h2>
      {record === undefined ? (
        <p className="mt-1 text-paper-muted">Loading…</p>
      ) : record === null ? (
        <p className="mt-1 text-paper-muted">
          Runs the project&apos;s GitHub Actions on this branch inside your fork, under your account&apos;s Actions minutes. Nothing is sent to the project.
        </p>
      ) : (
        <div role="status" className="mt-1">
          {record.summary.map((line, i) => (
            <p key={i} className={i === 0 ? TONE[record.status] ?? "text-paper" : "text-[14px] text-paper-muted"}>{line}</p>
          ))}
          {record.status === "needs_user_action" && (
            <p className="mt-2">
              <a href={record.actions_url} target="_blank" rel="noopener" className="btn-primary" data-size="sm">Enable Actions on your fork</a>
              <span className="ml-3 text-[14px] text-paper-muted">One time: GitHub asks you to allow workflows on a new fork. Then check again here.</span>
            </p>
          )}
          {record.status === "running" && record.fork_pr && (
            <p className="mt-1 text-[14px] text-paper-muted">Watching <a href={record.fork_pr.url} target="_blank" rel="noopener" className="link">the draft PR inside your fork</a>; this updates by itself.</p>
          )}
          {record.failures.map((f) => f.log && (
            <details key={f.url} className="mt-2">
              <summary className="cursor-pointer text-[14px]">Log: {f.job}{f.step ? ` (${f.step})` : ""}</summary>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap text-[12px] text-paper-muted">{f.log}</pre>
            </details>
          ))}
          {record.notes.map((n, i) => <p key={i} className="mt-1 text-[14px] text-paper-muted">{n}</p>)}
        </div>
      )}
      {(record === null || record?.status === "needs_user_action") && (
        <button onClick={() => void start()} disabled={busy} className="btn-quiet mt-3" data-size="sm">
          {busy ? "starting…" : record ? "Check again" : "Run CI in my fork"}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-alert">{error}</p>}
    </section>
  );
}
