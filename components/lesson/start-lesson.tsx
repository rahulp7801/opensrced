"use client";

// "Start a lesson" on an issue card (PLAN §7.8). Shown only when the page
// says lessons are on (OPENSRCER_LESSONS=1, read on the server). Creates the
// lesson, which starts the hidden fix, and opens it; the path (AI fix or
// write it yourself) is chosen on the lesson page.

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

  async function start() {
    setPending(true);
    setError(null);
    try {
      const repoUrl = repo.startsWith("https://") ? repo : `https://github.com/${repo}`;
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl, issue_number: issue }),
      });
      const body = (await res.json().catch(() => ({}))) as { lesson?: { id: string }; error?: string };
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
    </span>
  );
}
