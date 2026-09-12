"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DisconnectButton({ org }: { org: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setState("pending");
    setError(null);
    try {
      const res = await fetch(`/api/crucible/orgs/${encodeURIComponent(org)}/disconnect`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Disconnect failed: ${res.status}`);
        setState("confirming");
        return;
      }
      router.refresh();
    } catch (error) {
      setError(error instanceof Error && error.name === "TimeoutError" ? "Disconnect timed out. Try again." : "Network error. Try again.");
      setState("confirming");
    }
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => { setError(null); setState("confirming"); }}
        className="text-[11px] text-paper-muted hover:text-red-300 transition-colors"
        title="Revoke access to this org"
      >
        disconnect
      </button>
    );
  }

  if (state === "confirming") {
    return (
      <span className="flex flex-col items-end gap-1 text-[11px]">
        <span className="flex items-center gap-2">
          <span className="text-red-300">revoke access?</span>
          <button
            type="button"
            onClick={disconnect}
            className="text-red-400 hover:text-red-200 font-medium"
          >
            yes
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setState("idle"); }}
            className="text-paper-muted hover:text-paper"
          >
            no
          </button>
        </span>
        {error && <span role="alert" className="max-w-[240px] text-right text-alert">{error}</span>}
      </span>
    );
  }

  return (
    <span className="text-[11px] text-paper-muted animate-pulse">revoking…</span>
  );
}
