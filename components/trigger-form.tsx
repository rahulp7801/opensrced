"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";

type SubmitState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; message: string; queued_at: string; mode: string; dispatch_id?: string }
  | { kind: "err"; message: string };

function friendlyError(msg: string): string {
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) return "Could not reach the server. Check your connection and try again.";
  if (msg.includes("401") || msg.includes("unauthenticated")) return "Your session expired. Please log in again.";
  if (msg.includes("API key") || msg.includes("api key")) return "Missing API keys. Add them in Settings before running.";
  if (msg.includes("rate limit")) return "Rate limit hit. Wait a minute and try again.";
  if (msg.includes("repo_url")) return "Please enter a valid GitHub repository URL.";
  return msg;
}

export function TriggerForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [log, setLog] = useState<
    Array<{ t: string; repo: string; mode: string; status: "queued" | "error" }>
  >([]);

  // Pre-fill from URL params (e.g. ?repo=owner/name&issue=123&try=1)
  useEffect(() => {
    const repo = searchParams.get("repo");
    const issue = searchParams.get("issue");
    const tryMode = searchParams.get("try");
    if (repo) {
      setRepoUrl(issue ? `https://github.com/${repo}/issues/${issue}` : `https://github.com/${repo}`);
      if (tryMode === "1") setDryRun(true);
    }
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) {
      setState({ kind: "err", message: "Please enter a GitHub repository URL" });
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
      const dispatchId = data.dispatch_id;
      setState({
        kind: "ok",
        message: data.message ?? "queued",
        queued_at: data.queued_at ?? new Date().toISOString(),
        mode: data.mode ?? (dryRun ? "dry-run" : "live"),
        dispatch_id: dispatchId,
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
      toast("Run started — redirecting to live view...", "ok");
      setRepoUrl("");
      setNotes("");

      // Auto-redirect to the live run view after 1.5s
      if (dispatchId) {
        setTimeout(() => {
          router.push(`/dispatches/${dispatchId}`);
        }, 1500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: "err", message: friendlyError(msg) });
      toast(friendlyError(msg), "alert");
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
          label="Repository"
          hint="Paste a GitHub repo URL or issue URL"
        >
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo or https://github.com/owner/repo/issues/123"
            spellCheck={false}
            autoComplete="off"
            className="w-full border border-border bg-ink px-3 py-3 text-[14px] text-paper placeholder:text-paper-faint focus:border-signal focus:outline-none"
          />
        </Row>

        <Row label="Mode" hint="Preview runs analysis only. Live opens a PR when done.">
          <div className="flex gap-0 border border-border bg-ink w-fit">
            <button
              type="button"
              onClick={() => setDryRun(true)}
              className={cn(
                "px-4 py-2 text-[12px] uppercase tracking-[0.15em]",
                dryRun ? "bg-info/10 text-info" : "text-paper-muted hover:text-paper",
              )}
            >
              preview
            </button>
            <button
              type="button"
              onClick={() => setDryRun(false)}
              className={cn(
                "px-4 py-2 text-[12px] uppercase tracking-[0.15em] border-l border-border",
                !dryRun ? "bg-signal/10 text-signal" : "text-paper-muted hover:text-paper",
              )}
            >
              live (opens PR)
            </button>
          </div>
        </Row>

        <Row label="Priority">
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

        <Row label="Notes" hint="Optional guidance for the AI agent.">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. focus on security fixes, avoid license-encumbered files, skip tests/"
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
            {state.kind === "pending" ? (
              "Starting run..."
            ) : (
              <>
                <span className="text-signal">Fix this issue</span>
                <Arrow />
              </>
            )}
          </button>

          {state.kind === "ok" && (
            <div className="flex items-center gap-3 text-[12px]">
              <span className="text-ok flex items-center gap-1">
                <span aria-hidden>+</span> Run started
              </span>
              {state.dispatch_id && (
                <a
                  href={`/dispatches/${state.dispatch_id}`}
                  className="text-signal hover:underline"
                >
                  View live run
                </a>
              )}
            </div>
          )}
          {state.kind === "err" && (
            <div className="text-[12px] text-alert flex items-center gap-1">
              <span aria-hidden>x</span> {state.message}
            </div>
          )}
        </div>
      </form>

      <aside className="col-span-12 lg:col-span-4 border border-border bg-surface/40 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="mono-label text-paper-muted">Run history</span>
          <span className="mono-label text-paper-faint tabular-nums">
            {log.length.toString().padStart(2, "0")}
          </span>
        </div>
        {log.length === 0 ? (
          <div className="p-6 text-[12px] text-paper-muted">
            No runs yet. Start your first run to see history here.
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
                    "inline-flex items-center justify-center h-4 w-4 text-[10px]",
                    l.status === "queued" ? "text-ok" : "text-alert",
                  )}
                  role="img"
                  aria-label={l.status}
                >
                  {l.status === "queued" ? "+" : "x"}
                </span>
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
        <div className="text-[12px] text-paper font-medium">{label}</div>
        {hint && (
          <div className="mt-1 text-[10.5px] text-paper-faint leading-relaxed">
            {hint}
          </div>
        )}
      </div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="text-signal group-hover:translate-x-0.5 transition-transform" aria-hidden>
      <path d="M2 6h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
