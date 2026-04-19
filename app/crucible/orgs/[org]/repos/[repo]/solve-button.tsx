"use client";

// Client-side CTA for crucible findings. POSTs to /api/crucible/run/agentic
// with orgCtx so the dispatcher uses the installation token. Redirects to
// /dispatches/<id> on success so the user can watch the stream.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Estimate API cost based on repo size. Larger repos need more exploration
// tokens. Based on observed costs across real dispatches.
function estimateCost(sizeKb: number): string {
  const sizeMb = sizeKb / 1024;
  if (sizeMb < 1) return "$0.03–$0.08";
  if (sizeMb < 10) return "$0.05–$0.12";
  if (sizeMb < 50) return "$0.08–$0.20";
  if (sizeMb < 200) return "$0.12–$0.35";
  return "$0.20–$0.50";
}

export function SolveButton({
  repoFull,
  kind,
  findingId,
  githubOrg,
  findingSummary,
  findingDescription,
  cveId,
  affectedPackage,
  affectedVersions,
  repoSizeKb,
}: {
  repoFull: string;
  kind: "advisory" | "dependabot" | "issue";
  findingId: string;
  githubOrg: string;
  findingSummary?: string;
  findingDescription?: string;
  cveId?: string;
  affectedPackage?: string;
  affectedVersions?: string;
  repoSizeKb?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    const cached = sessionStorage.getItem("opensrcer-has-key");
    if (cached !== null) { setHasKey(cached === "1"); return; }
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d: { anthropic?: boolean; gemini?: boolean }) => setHasKey(Boolean(d.anthropic) && Boolean(d.gemini)))
      .catch(() => {});
  }, []);

  async function onClick() {
    setState("pending");
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        repo_url: `https://github.com/${repoFull}`,
        github_org: githubOrg,
        kind,
      };
      if (kind === "issue") {
        payload.issue_number = Number(findingId);
      } else {
        payload.finding = {
          id: findingId,
          kind,
          summary: findingSummary,
          description: findingDescription,
          cve_id: cveId,
          affected_package: affectedPackage,
          affected_versions: affectedVersions,
        };
      }
      const res = await fetch("/api/crucible/run/agentic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "pending" || !hasKey}
        title={!hasKey ? "Add API keys in Crucible → API Keys" : `Estimated cost: ~${estimateCost(repoSizeKb ?? 0)}`}
        className="text-[12px] text-paper border border-border bg-surface/60 hover:bg-surface px-2.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {!hasKey ? "no API key" : state === "pending" ? "dispatching…" : "deep solve"}
      </button>
      {hasKey && state === "idle" && (
        <span className="text-[9px] text-paper-faint tabular-nums">est. ~{estimateCost(repoSizeKb ?? 0)}</span>
      )}
      {state === "error" && error && (
        <span className="text-[10.5px] text-red-300 max-w-[220px] text-right">
          {error}
        </span>
      )}
    </div>
  );
}
