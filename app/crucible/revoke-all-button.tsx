"use client";

import { useState } from "react";

export function RevokeAllButton() {
  const [state, setState] = useState<"idle" | "confirm" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setState("pending");
    setError(null);
    try {
      const res = await fetch("/api/auth/revoke-all", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json().catch(() => null) as { redirect?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (typeof data?.redirect !== "string" || !data.redirect.startsWith("/auth/logout?")) {
        throw new Error("The server returned an invalid logout response.");
      }
      window.location.assign(data.redirect);
    } catch (error) {
      setError(error instanceof Error && error.name === "TimeoutError"
        ? "Revoke timed out. Try again."
        : error instanceof Error ? error.message : "Failed to revoke. Try again.");
      setState("idle");
    }
  }

  if (state === "idle") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => { setError(null); setState("confirm"); }}
          className="text-[12px] text-alert hover:text-red-200 transition"
        >
          Disconnect all &amp; sign out
        </button>
        {error && <p role="alert" className="text-xs text-alert">{error}</p>}
      </div>
    );
  }

  if (state === "confirm") {
    return (
      <div className="border border-red-900/60 bg-red-950/20 p-4 space-y-3">
        <div className="text-[13px] text-red-300 font-medium">
          Disconnect this account?
        </div>
        <div className="text-[12px] text-paper-dim leading-relaxed">
          This will:
        </div>
        <ul className="text-[12px] text-paper-dim leading-relaxed list-disc list-inside space-y-1">
          <li>Stop your active hosted runs before access is cleared</li>
          <li>Disconnect all GitHub organizations you&apos;ve connected</li>
          <li>Revoke all cached installation tokens immediately</li>
          <li>Sign you out and destroy your session</li>
          <li>Your GitHub OAuth authorization remains — revoke it at{" "}
            <a
              href="https://github.com/settings/applications"
              target="_blank"
              rel="noreferrer"
              className="text-paper hover:text-signal underline"
            >
              github.com/settings/applications
            </a>
            {" "}if you want to fully deauthorize
          </li>
        </ul>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={revoke}
            className="text-[12px] text-red-300 border border-red-800 bg-red-950/40 px-3 py-1.5 hover:bg-red-900/40 transition"
          >
            Stop runs, disconnect, and sign out
          </button>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="text-[12px] text-paper-muted hover:text-paper px-3 py-1.5 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-[12px] text-red-300 animate-pulse" role="status">
      Revoking all access and signing out…
    </div>
  );
}
