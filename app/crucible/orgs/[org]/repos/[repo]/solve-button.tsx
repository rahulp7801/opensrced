"use client";

// Client-side CTA for crucible findings. POSTs to /api/crucible/run/agentic
// with orgCtx so the dispatcher uses the installation token. Redirects to
// /dispatches/<id> on success so the user can watch the stream.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SolveButton({
  repoFull,
  kind,
  findingId,
  githubOrg,
}: {
  repoFull: string;
  kind: "advisory" | "dependabot" | "issue";
  findingId: string;
  githubOrg: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Only `issue` kind currently has a numeric #N we can pass to the agentic
  // dispatcher. Advisories / dependabot alerts need a different prompt
  // strategy (not yet wired — flag as coming-soon for MVP).
  const supported = kind === "issue";

  async function onClick() {
    if (!supported) return;
    setState("pending");
    setError(null);
    try {
      const res = await fetch("/api/crucible/run/agentic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo_url: `https://github.com/${repoFull}`,
          issue_number: Number(findingId),
          github_org: githubOrg,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        dispatch_id?: string;
      };
      if (!res.ok || !json.dispatch_id) {
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      router.push(`/dispatches?dispatch=${json.dispatch_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  if (!supported) {
    return (
      <span className="text-[11px] text-paper-muted border border-border-soft px-2 py-1">
        solve (coming soon)
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "pending"}
        className="text-[12px] text-paper border border-border bg-surface/60 hover:bg-surface px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "pending" ? "dispatching…" : "deep solve"}
      </button>
      {state === "error" && error && (
        <span className="text-[10.5px] text-red-300 max-w-[220px] text-right">
          {error}
        </span>
      )}
    </div>
  );
}
