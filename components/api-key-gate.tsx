"use client";

import { pollJson } from "@/lib/poll-json";
import { useEffect, useState } from "react";
import { useCanUseApp } from "@/lib/use-current-user";
import { usePathname } from "next/navigation";
import Link from "next/link";

// Only these pages require a key to perform their primary action. Viewing run
// history, PRs, issues, graphs, and settings remains useful without one.
const KEY_REQUIRED_PAGES = ["/trigger", "/explore"];

export function ApiKeyGate({ localMode = false, inviteOnly = false }: { localMode?: boolean; inviteOnly?: boolean }) {
  // `user` here means "may use the app" (see useCanUseApp).
  const { canUse } = useCanUseApp(localMode, inviteOnly);
  const user = canUse;
  const pathname = usePathname();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  // Hosted deployments offer only the API key; don't point people at a sign-in they can't use.
  const [subscriptions, setSubscriptions] = useState(false);
  const needsKey = KEY_REQUIRED_PAGES.some((path) => pathname === path || pathname.startsWith(path + "/"));

  useEffect(() => {
    setHasKey(null);
    if (!needsKey || (!user && !localMode)) return;
    let stop: (() => void) | undefined;
    function check() {
      stop?.();
      // `ready`: some payment method the user allowed can start a run now.
      stop = pollJson<{ anthropic?: boolean; ready?: boolean; offered?: string[] }>("/api/settings/keys", ({ data }) => {
        setHasKey(data ? Boolean(data.ready ?? data.anthropic) : null);
        setSubscriptions(Boolean(data?.offered?.some((p) => p !== "anthropic-key")));
      });
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
      <span className="font-medium text-signal">{subscriptions ? "Choose how runs are paid for" : "Anthropic key required"}</span>
      <span className="hidden text-paper-muted md:inline">
        {subscriptions
          ? "Sign in with your Claude or ChatGPT subscription, or add an API key, to start an AI run."
          : "Add your Anthropic key to start an AI run. Gemini review is optional."}
      </span>
      <Link
        href="/crucible"
        className="rounded-full inline-flex min-h-8 items-center border border-signal/30 px-2.5 text-signal transition hover:bg-signal/10"
      >
        Open settings
      </Link>
    </aside>
  );
}
