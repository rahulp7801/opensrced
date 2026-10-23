"use client";

// The publish gate on the run page: the frozen preview (PR text, evidence,
// warnings, blockers) and the only way to open a PR. Publishing needs an
// explicit confirmation and uses exactly what is shown here.

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

type Preview = {
  title: string;
  body: string;
  files: string[];
  signoff: boolean;
  executed: boolean;
  verification: { status: string; reason: string } | null;
  blockers: string[];
  warnings: string[];
  draft_issue_comment?: string;
  confirmation: string;
  publishable: boolean;
};

export function PublishPanel({ dispatchId, onPublished }: { dispatchId: string; onPublished?: (url: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dispatches/${dispatchId}/preview`, { signal: controller.signal })
      .then(async (r) => (r.ok ? setPreview(await r.json()) : r.status === 404 ? null : setLoadError("Could not load the preview.")))
      .catch(() => { if (!controller.signal.aborted) setLoadError("Could not load the preview."); });
    return () => controller.abort();
  }, [dispatchId]);

  if (loadError) return <div role="alert" className="border-b border-alert/40 px-4 py-2.5 text-[12px] text-alert">{loadError}</div>;
  if (!preview) return null;

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/dispatches/${dispatchId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
        signal: AbortSignal.timeout(300_000),
      });
      const result = (await r.json().catch(() => ({}))) as { error?: string; pr_url?: string };
      if (!r.ok || !result.pr_url) throw new Error(result.error ?? "Could not publish.");
      onPublished?.(result.pr_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish.");
    } finally {
      setPending(false);
    }
  }

  const v = preview.verification;
  const verdict = !preview.executed ? "not verified (no code was run)" : !v ? "not verified" : `${v.status} — ${v.reason}`;
  return (
    <section aria-label="Review before publishing" className="border-b border-border px-4 py-3 text-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium text-paper">Review before publishing</h3>
        <span className={v?.status === "verified" ? "text-ok" : "text-alert"}>Verification: {verdict}</span>
      </div>
      <p className="mt-1 text-paper-muted">
        Nothing has been posted. Publishing opens a draft PR from your account with exactly this patch and text
        ({preview.files.length} file{preview.files.length === 1 ? "" : "s"}{preview.signoff ? ", signed off for the DCO" : ""}).
      </p>
      {preview.blockers.map((b) => <p key={b} role="alert" className="mt-2 text-alert">Blocked: {b}</p>)}
      {preview.warnings.map((w) => <p key={w} className="mt-2 text-paper-muted">Note: {w}</p>)}
      <details className="mt-2">
        <summary className="cursor-pointer text-paper">PR text: {preview.title}</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border-soft bg-surface p-3 text-[11px] text-paper-muted">{preview.body}</pre>
      </details>
      {preview.draft_issue_comment && (
        <div className="mt-2">
          <p className="text-paper">Suggested instead: ask on the issue first. Post this yourself if it reads right:</p>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-border-soft bg-surface p-3 text-[11px] text-paper-muted">{preview.draft_issue_comment}</pre>
          <button className="mt-1 text-xs text-signal hover:underline" onClick={() => void copyText(preview.draft_issue_comment!).then(() => setCopied(true))}>
            {copied ? "copied" : "copy comment"}
          </button>
        </div>
      )}
      {preview.publishable && preview.blockers.length === 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-paper">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {preview.confirmation}
          </label>
          <button
            onClick={publish}
            disabled={!confirmed || pending}
            className="rounded-full border border-ok/50 bg-ok/10 px-3 py-1 text-[12px] text-ok hover:bg-ok/20 disabled:opacity-50"
          >
            {pending ? "publishing…" : "Publish draft PR"}
          </button>
          {error && <span role="alert" className="basis-full text-alert">{error}</span>}
        </div>
      )}
    </section>
  );
}
