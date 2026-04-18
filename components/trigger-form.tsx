"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type SubmitState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; message: string; queued_at: string; mode: string; dispatch_id?: string }
  | { kind: "err"; message: string };

export function TriggerForm() {
  const [repoUrl, setRepoUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [log, setLog] = useState<
    Array<{ t: string; repo: string; mode: string; status: "queued" | "error" }>
  >([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) {
      setState({ kind: "err", message: "repo_url is required" });
      return;
    }
    setState({ kind: "pending" });
    try {
      const res = await fetch("/api/run/target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl.trim(), dry_run: dryRun, priority, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
      setState({
        kind: "ok",
        message: data.message ?? "queued",
        queued_at: data.queued_at ?? new Date().toISOString(),
        mode: data.mode ?? (dryRun ? "dry-run" : "live"),
        dispatch_id: data.dispatch_id,
      });
      setLog((prev) =>
        [
          {
            t: new Date().toISOString().slice(11, 19),
            repo: repoUrl.trim(),
            mode: dryRun ? "dry-run" : "live",
            status: "queued" as const,
          },
          ...prev,
        ].slice(0, 12),
      );
      setRepoUrl("");
      setNotes("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: "err", message: msg });
      setLog((prev) =>
        [
          {
            t: new Date().toISOString().slice(11, 19),
            repo: repoUrl.trim() || "—",
            mode: dryRun ? "dry-run" : "live",
            status: "error" as const,
          },
          ...prev,
        ].slice(0, 12),
      );
    }
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      <form
        onSubmit={submit}
        className="col-span-12 lg:col-span-8 border border-border bg-surface/40 p-6"
      >
        <Row
          label="TARGET · repo_url"
          hint="https://github.com/owner/repo"
        >
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/astral-sh/ruff"
            spellCheck={false}
            autoComplete="off"
            className="w-full border border-border bg-ink px-3 py-3 text-[14px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none"
          />
        </Row>

        <Row label="MODE · dry_run" hint="dry-run skips network side effects.">
          <div className="flex gap-0 border border-border bg-ink w-fit">
            {[
              { key: true, label: "dry-run" },
              { key: false, label: "live" },
            ].map((o, i) => (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => setDryRun(o.key)}
                className={cn(
                  "px-4 py-2 text-[12px] uppercase tracking-[0.15em] border-l first:border-l-0 border-border",
                  dryRun === o.key
                    ? i === 0
                      ? "bg-info/10 text-info"
                      : "bg-signal/10 text-signal"
                    : "text-paper-muted hover:text-paper",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="PRIORITY · queue_depth">
          <div className="flex gap-0 border border-border bg-ink w-fit">
            {(["normal", "high"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "px-4 py-2 text-[12px] uppercase tracking-[0.15em] border-l first:border-l-0 border-border",
                  priority === p ? "bg-paper/10 text-paper" : "text-paper-muted hover:text-paper",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </Row>

        <Row label="NOTES · optional" hint="Free-form guidance for the analyzer.">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="focus on security fixes, avoid license-encumbered files, skip tests/"
            className="w-full border border-border bg-ink px-3 py-3 text-[13px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none resize-none"
          />
        </Row>

        <div className="mt-4 flex items-center gap-4">
          <button
            type="submit"
            disabled={state.kind === "pending"}
            className={cn(
              "group inline-flex items-center gap-3 border px-5 py-3 text-[13px] transition",
              state.kind === "pending"
                ? "border-border text-paper-muted"
                : "border-signal bg-signal/10 text-paper hover:bg-signal/20",
            )}
          >
            <span className="mono-label text-signal">[dispatch]</span>
            {state.kind === "pending" ? "queuing…" : "launch target"}
            <Arrow />
          </button>

          {state.kind === "ok" && (
            <div className="flex items-center gap-3 text-[12px]">
              <span className="text-ok">✓ {state.message}</span>
              {state.dispatch_id && (
                <a
                  href="/dispatches"
                  className="text-signal hover:underline"
                >
                  watch live log →
                </a>
              )}
            </div>
          )}
          {state.kind === "err" && (
            <div className="text-[12px] text-alert">✗ {state.message}</div>
          )}
        </div>

        <p className="mt-6 text-[11px] text-paper-muted leading-relaxed">
          POST /api/run/target · mirrors the agent REST contract. When
          <code className="mx-1 text-paper">CONTRIBAI_API_URL</code> is set, this form proxies
          directly to the running Rust web-server.
        </p>
      </form>

      <aside className="col-span-12 lg:col-span-4 border border-border bg-surface/40 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="mono-label text-paper-muted">[dispatch log]</span>
          <span className="mono-label text-paper-faint tabular-nums">
            {log.length.toString().padStart(2, "0")}
          </span>
        </div>
        {log.length === 0 ? (
          <div className="p-6 text-[12px] text-paper-muted">
            No dispatches yet. Your launches in this session will appear here.
          </div>
        ) : (
          <ul>
            {log.map((l, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 px-4 py-2.5 text-[12px] ${i > 0 ? "border-t border-border-soft" : ""}`}
              >
                <span className="mono-label text-paper-faint tabular-nums">{l.t}</span>
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    l.status === "queued" ? "bg-ok" : "bg-alert",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-paper">{l.repo}</span>
                <span className="mono-label text-paper-muted">{l.mode}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-12 gap-4 items-start">
      <div className="col-span-12 md:col-span-3">
        <div className="mono-label text-paper-muted">{label}</div>
        {hint && <div className="mt-1 text-[10px] text-paper-faint">{hint}</div>}
      </div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
    </svg>
  );
}
