"use client";

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

    function onStorage(e: StorageEvent) {
      if (e.key === "opensrcer-has-key" || e.key === null) check();
    }
    const poll = setInterval(() => {
      const cached = sessionStorage.getItem("opensrcer-has-key");
      if (cached === null) check();
    }, 1000);

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
    };
  }, [user]);

  // Don't show if: not logged in, still loading, key is set, or on a key-free page
  if (!user || hasKey === null || hasKey) return null;
  if (KEY_FREE_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  return (
    <div className="border-b border-signal/40 bg-signal/5 px-4 py-2.5 flex items-center justify-center gap-3 text-[12px]">
      <span className="text-signal font-medium">API keys needed for this page</span>
      <span className="text-paper-muted">
        Add your Anthropic + Gemini keys to use AI features.
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
