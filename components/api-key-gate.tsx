"use client";

import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import Link from "next/link";

export function ApiKeyGate() {
  const { user } = useUser();
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((d: { anthropic?: boolean }) => setHasKey(Boolean(d.anthropic)))
      .catch(() => setHasKey(null));
  }, [user]);

  // Don't show if not logged in, still loading, or key is set
  if (!user || hasKey === null || hasKey) return null;

  return (
    <div className="border-b border-signal/40 bg-signal/5 px-4 py-2.5 flex items-center justify-center gap-3 text-[12px]">
      <span className="text-signal font-medium">Anthropic API key required</span>
      <span className="text-paper-muted">
        — set one in
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
