"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { SHARED_FIX_RETENTION_MS, type SharedFix } from "@/lib/shared-fix-data";

export default function SharedFixPage() {
  const { id } = useParams<{ id: string }>();
  const [fix, setFix] = useState<SharedFix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyDiff() {
    if (!fix?.diff) return;
    try {
      await copyText(fix.diff);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/fixes/${encodeURIComponent(id)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    })
      .then((r) => {
        if (r.ok) return r.json();
        // Only a 404 means the link is dead; anything else is the server, and worth a retry.
        throw new Error(r.status === 404
          ? "This shared fix link may have expired or been deleted."
          : `Could not load this fix right now (${r.status}). Try again in a moment.`);
      })
      .then(setFix)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error && err.name === "TimeoutError" ? "Loading this fix timed out."
            : err instanceof SyntaxError ? "The server returned an invalid response. Try again in a moment."
            : err instanceof TypeError ? "Network connection lost. Check your connection and try again."
            : err instanceof Error ? err.message : "Could not load this fix.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-5 py-12 sm:px-8" aria-busy="true">
        {/* The skeleton has no text, so give assistive tech something to announce. */}
        <h1 className="sr-only">Loading shared fix…</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-3 w-32 rounded-full bg-surface-2" />
          <div className="h-12 w-72 max-w-full rounded-2xl bg-surface-3" />
          <div className="h-64 rounded-[20px] bg-surface-2" />
        </div>
      </div>
    );
  }

  if (error || !fix) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-5 py-16 sm:px-8">
        <h1 className="display text-[44px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[56px]">Could not load fix</h1>
        <p className="mt-5 max-w-xl text-[16px] leading-[1.6] text-paper-muted">{error ?? "This shared fix link may have expired or been deleted."}</p>
        <button onClick={() => window.location.reload()} className="btn-quiet mt-7">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-10 sm:px-8">
      {/* Header: the same rhythm as every app page (kicker, display title, quiet line). */}
      <div className="pt-2 sm:pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="kicker text-signal">shared fix</span>
          {fix.pr_number && (
            <span className="chip chip-info">PR #{fix.pr_number}</span>
          )}
          <span className="ml-auto text-[13px] text-paper-muted">{new Date(fix.created_at).toLocaleString()}</span>
        </div>
        <h1 className="display mt-4 break-all text-[40px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[56px]">{fix.repo}</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-[1.6] text-paper-muted">Shared by an opensrcer user. opensrcer does not review shared fixes; check the code before you use it.</p>

        {fix.comment_body && (
          <div className="mt-6 border-l-2 border-signal pl-4 text-[16px] leading-[1.6] text-paper-dim">
            <span className="kicker mb-1 block text-paper-muted">Review comment</span>
            {fix.comment_body}
          </div>
        )}
      </div>

      {/* Explainer */}
      {fix.explainer && (
        <div className="callout callout-ok mt-8 px-5 py-4">
          <span className="kicker mb-1.5 block text-ok">Why this fix</span>
          <p className="text-[16px] leading-[1.6] text-paper-dim whitespace-pre-wrap">{fix.explainer}</p>

        </div>
      )}

      {/* Diff */}
      {fix.diff && (
        <div className="card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-3">
            <span className="kicker text-paper-muted">Diff</span>
            <button
              onClick={copyDiff}
              aria-live="polite"
              className={cn("btn-quiet", copyState === "error" && "text-alert")}
              data-size="sm"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy diff"}
            </button>
          </div>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed">
            {fix.diff.split("\n").map((line, i) => {
              let cls = "text-paper-dim";
              if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-ok";
              else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-alert";
              else if (line.startsWith("@@")) cls = "text-info";
              return <div key={i} className={cn("whitespace-pre-wrap", cls)}>{line || "\u00a0"}</div>;
            })}
          </pre>
        </div>
      )}

      {/* Full response */}
      <details className="card mt-4 overflow-hidden">
        <summary className="flex min-h-11 cursor-pointer items-center px-5 text-[15px] font-medium text-paper hover:text-signal">
          Full AI response
        </summary>
        <div className="border-t border-border-soft px-5 py-4 text-[16px] leading-[1.6] text-paper-dim whitespace-pre-wrap break-words">
          {fix.fix_response}
        </div>
      </details>

      {/* Footer */}
      <div className="mt-8 text-[13px] text-paper-muted">

        <p>Available until {new Date(Date.parse(fix.created_at) + SHARED_FIX_RETENTION_MS).toLocaleString()}</p>
      </div>
    </div>
  );
}
