"use client";

import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import Link from "next/link";

export function ApiKeyGate() {
  const { user } = useUser();
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;

    function check() {
      const cached = sessionStorage.getItem("opensrcer-has-key");
      if (cached !== null) {
        setHasKey(cached === "1");
        return;
      }
      fetch("/api/settings/keys")
        .then((r) => r.json())
        .then((d: { anthropic?: boolean; gemini?: boolean }) => {
          const has = Boolean(d.anthropic) && Boolean(d.gemini);
          setHasKey(has);
          sessionStorage.setItem("opensrcer-has-key", has ? "1" : "0");
        })
        .catch(() => setHasKey(null));
    }

    check();

    // Re-check when sessionStorage is cleared (key saved/removed on Crucible page)
    function onStorage(e: StorageEvent) {
      if (e.key === "opensrcer-has-key" || e.key === null) check();
    }
    // StorageEvent only fires cross-tab. For same-tab, poll sessionStorage.
    const poll = setInterval(() => {
      const cached = sessionStorage.getItem("opensrcer-has-key");
      if (cached === null) check(); // cache was cleared — re-fetch
    }, 1000);

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
    };
  }, [user]);

  // Don't show if not logged in, still loading, or key is set
  if (!user || hasKey === null || hasKey) return null;

  return (
    <div className="border-b border-signal/40 bg-signal/5 px-4 py-2.5 flex items-center justify-center gap-3 text-[12px]">
      <span className="text-signal font-medium">API keys required</span>
      <span className="text-paper-muted">
        — add Anthropic + Gemini keys in
      </span>
      <Link
        href="/crucible"
        className="text-signal underline hover:text-signal-soft"
      >
        Crucible → API Keys
      </Link>
      <span className="text-paper-muted">
        to use Explore, Dispatches, and Deep Solve.
      </span>
    </div>
  );
}
