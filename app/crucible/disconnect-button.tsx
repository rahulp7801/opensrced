"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DisconnectButton({ org }: { org: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirming" | "pending">("idle");

  async function disconnect() {
    setState("pending");
    try {
      const res = await fetch(`/api/crucible/orgs/${org}/disconnect`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error || `Disconnect failed: ${res.status}`);
        setState("idle");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error");
      setState("idle");
    }
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("confirming")}
        className="text-[11px] text-paper-muted hover:text-red-300 transition-colors"
        title="Revoke access to this org"
      >
        disconnect
      </button>
    );
  }

  if (state === "confirming") {
    return (
      <span className="flex items-center gap-2 text-[11px]">
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
          onClick={() => setState("idle")}
          className="text-paper-muted hover:text-paper"
        >
          no
        </button>
      </span>
    );
  }

  return (
    <span className="text-[11px] text-paper-muted animate-pulse">revoking…</span>
  );
}
