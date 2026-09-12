"use client";

import { pollJson } from "@/lib/poll-json";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/use-current-user";
import { usePathname } from "next/navigation";
import Link from "next/link";

// Only these pages require a key to perform their primary action. Viewing run
// history, PRs, issues, graphs, and settings remains useful without one.
const KEY_REQUIRED_PAGES = ["/trigger", "/explore"];

export function ApiKeyGate({ localMode = false }: { localMode?: boolean }) {
  const { user } = useCurrentUser(localMode);
  const pathname = usePathname();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const needsKey = KEY_REQUIRED_PAGES.some((path) => pathname === path || pathname.startsWith(path + "/"));

  useEffect(() => {
    setHasKey(null);
    if (!needsKey || (!user && !localMode)) return;
    let stop: (() => void) | undefined;
    function check() {
      stop?.();
      stop = pollJson<{ anthropic?: boolean }>("/api/settings/keys", ({ data }) => setHasKey(data ? Boolean(data.anthropic) : null));
    }
    check();
    window.addEventListener("opensrcer-keys-updated", check);
    return () => { stop?.(); window.removeEventListener("opensrcer-keys-updated", check); };
  }, [user, localMode, needsKey]);

  // Don't show if: not logged in, still loading, key is set, or this page's
  // primary action works without a provider key.
  if (!needsKey || (!user && !localMode) || hasKey === null || hasKey) return null;

  return (
    <aside aria-label="Provider setup" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-signal/40 bg-signal/5 px-4 py-2.5 text-[12px]">
      <span className="font-medium text-signal">Anthropic key required</span>
      <span className="hidden text-paper-muted md:inline">
        Add your Anthropic key to start an AI run. Gemini review is optional.
      </span>
      <Link
        href="/crucible"
        className="inline-flex min-h-8 items-center border border-signal/30 px-2.5 text-signal transition hover:bg-signal/10"
      >
        Open settings
      </Link>
    </aside>
  );
}
