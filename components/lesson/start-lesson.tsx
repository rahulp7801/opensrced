"use client";

// "Start a lesson" on an issue card (PLAN §7.8). Shown only when the page
// says lessons are on (OPENSRCER_LESSONS=1, read on the server). Creates the
// lesson, which starts the hidden fix, and opens it; the path (AI fix or
// write it yourself) is chosen on the lesson page. When someone else seems
// to have the issue already (assigned, asked for it, or has an open PR), the
// server answers 409 with a warning first, and "Start anyway" goes ahead.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartLessonButton({ repo, issue, className }: {
  /** owner/name or a GitHub URL. */
  repo: string;
  issue: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Someone else may have the issue (lib/lesson/claim.ts): the server's warning, until "Start anyway".
  const [claimed, setClaimed] = useState<{ warning: string; urls: string[] } | null>(null);

  async function start(claimOk = false) {
    setPending(true);
    setError(null);
    setClaimed(null);
    try {
      const repoUrl = repo.startsWith("https://") ? repo : `https://github.com/${repo}`;
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl, issue_number: issue, ...(claimOk ? { claim_ok: true } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { lesson?: { id: string }; error?: string; claimed?: Array<{ url: string }> };
      if (res.status === 409 && body.claimed) {
        setClaimed({ warning: body.error ?? "Someone may already be working on this issue.", urls: [...new Set(body.claimed.map((c) => c.url))].slice(0, 3) });
        setPending(false);
        return;
      }
      if (!res.ok || !body.lesson) throw new Error(body.error ?? `Could not start the lesson (${res.status}).`);
      router.push(`/learn/${body.lesson.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the lesson.");
      setPending(false);
    }
  }

  return (
    <span className={className}>
      <button type="button" onClick={() => void start()} disabled={pending} className="row-cta" title="Learn to fix it yourself, with a teacher">
        {pending ? "Starting…" : <>Start a lesson <span aria-hidden>→</span></>}
      </button>
      {error && <span role="alert" className="mt-1 block max-w-xs text-[13px] text-alert">{error}</span>}
      {claimed && (
        <span role="alert" className="mt-1 block max-w-xs text-left text-[13px] text-paper-dim">
          {claimed.warning}
          {claimed.urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="link mt-0.5 block truncate">{url.replace("https://github.com/", "")}<span aria-hidden>↗</span></a>)}
          <button type="button" onClick={() => void start(true)} disabled={pending} className="link mt-1 block">Start anyway</button>
        </span>
      )}
    </span>
  );
}
