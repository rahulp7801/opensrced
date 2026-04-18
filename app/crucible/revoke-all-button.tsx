"use client";

import { useState } from "react";

export function RevokeAllButton() {
  const [state, setState] = useState<"idle" | "confirm1" | "confirm2" | "pending">("idle");

  async function revoke() {
    setState("pending");
    try {
      const res = await fetch("/api/auth/revoke-all", { method: "POST" });
      const data = (await res.json()) as { redirect?: string };
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    } catch {
      alert("Failed to revoke. Try again.");
      setState("idle");
    }
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState("confirm1")}
        className="text-[12px] text-red-400/70 hover:text-red-300 transition"
      >
        Delete all connections &amp; sign out
      </button>
    );
  }

  if (state === "confirm1") {
    return (
      <div className="border border-red-900/60 bg-red-950/20 p-4 space-y-3">
        <div className="text-[13px] text-red-300 font-medium">
          Are you sure?
        </div>
        <div className="text-[12px] text-paper-dim leading-relaxed">
          This will:
        </div>
        <ul className="text-[12px] text-paper-dim leading-relaxed list-disc list-inside space-y-1">
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
            onClick={() => setState("confirm2")}
            className="text-[12px] text-red-300 border border-red-800 bg-red-950/40 px-3 py-1.5 hover:bg-red-900/40 transition"
          >
            Yes, revoke everything
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

  if (state === "confirm2") {
    return (
      <div className="border border-red-900/60 bg-red-950/30 p-4 space-y-3">
        <div className="text-[13px] text-red-200 font-medium">
          Final confirmation
        </div>
        <div className="text-[12px] text-paper-dim">
          This action cannot be undone. You will be signed out immediately.
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={revoke}
            className="text-[12px] text-white border border-red-700 bg-red-800/80 px-3 py-1.5 hover:bg-red-700 transition font-medium"
          >
            Confirm — delete everything
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
    <div className="text-[12px] text-red-300 animate-pulse">
      Revoking all access and signing out…
    </div>
  );
}
