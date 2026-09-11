"use client";

import { pollJson } from "@/lib/poll-json";
import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { usePathname } from "next/navigation";
import Link from "next/link";

// Pages that work WITHOUT API keys (public repo browsing, PRs, repos)
const KEY_FREE_PAGES = ["/prs", "/repos", "/discover", "/issues", "/stats", "/graph"];

export function ApiKeyGate() {
  const { user } = useUser();
  const pathname = usePathname();
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    setHasKey(null);
    if (!user) return;
    let stop: (() => void) | undefined;
    function check() {
      stop?.();
      stop = pollJson<{ anthropic?: boolean }>("/api/settings/keys", ({ data }) => setHasKey(data ? Boolean(data.anthropic) : null));
    }
    check();
    window.addEventListener("opensrcer-keys-updated", check);
    return () => { stop?.(); window.removeEventListener("opensrcer-keys-updated", check); };
  }, [user]);

  // Don't show if: not logged in, still loading, key is set, or on a key-free page
  if (!user || hasKey === null || hasKey) return null;
  if (KEY_FREE_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  return (
    <div className="border-b border-signal/40 bg-signal/5 px-4 py-2.5 flex items-center justify-center gap-3 text-[12px]">
      <span className="text-signal font-medium">API keys needed for this page</span>
      <span className="text-paper-muted">
        Add your Anthropic key to start an AI run. Gemini review is optional.
      </span>
      <Link
        href="/crucible"
        className="text-signal border border-signal/30 px-2.5 py-0.5 hover:bg-signal/10 transition"
      >
        Add keys in Settings
      </Link>
    </div>
  );
}
