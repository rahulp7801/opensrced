"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/use-current-user";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconClose } from "@/components/icons";

type OnboardingState = {
  hasKey: boolean;
  hasDispatch: boolean;
};

const STEPS = [
  {
    key: "key" as const,
    title: "Add an Anthropic API key",
    description: "Add the provider key used for agent runs. You can add Gemini later for patch review.",
    href: "/crucible",
    cta: "Go to Settings",
    check: (s: OnboardingState) => s.hasKey,
  },
  {
    key: "dispatch" as const,
    title: "Fix an issue",
    description: "Choose an open issue in Discover, then generate a preview you can review before publishing.",
    href: "/discover",
    cta: "Discover issues",
    check: (s: OnboardingState) => s.hasDispatch,
  },
];

// Don't show onboarding on these pages — they're where the user
// completes the steps, so showing the prompt would be redundant.
// Key-required pages already show the persistent ApiKeyGate. Keeping onboarding
// off them avoids two banners with two buttons for the same settings page.
const HIDDEN_ON = ["/crucible", "/login", "/", "/trigger", "/explore"];

export function Onboarding({ localMode = false }: { localMode?: boolean }) {
  const { user } = useCurrentUser(localMode);
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user && !localMode) return;
    try {
      if (sessionStorage.getItem("opensrcer-onboarding-dismissed") === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      // The checklist remains usable when privacy settings block storage.
    }

    // Only required first-run tasks belong here. Organization access is
    // optional for people working with public repositories.
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    Promise.all([
      fetch("/api/settings/keys", { signal }).then(async (response) => {
        if (!response.ok) throw new Error("Settings unavailable");
        const data = await response.json() as { anthropic?: unknown };
        return data.anthropic === true;
      }),
      fetch("/api/dispatches", { signal }).then(async (response) => {
        if (!response.ok) throw new Error("Runs unavailable");
        const data = await response.json() as { dispatches?: unknown };
        if (!Array.isArray(data.dispatches)) throw new Error("Invalid runs response");
        return data.dispatches.length > 0;
      }),
    ]).then(([hasKey, hasDispatch]) => {
      if (!controller.signal.aborted) setState({ hasKey, hasDispatch });
    }).catch(() => {
      // Do not turn a service failure into incorrect setup guidance.
    });
    return () => controller.abort();
  }, [user, localMode]);

  if ((!user && !localMode) || !state || dismissed) return null;

  // All done — don't show
  const allDone = STEPS.every((s) => s.check(state));
  if (allDone) return null;

  // Don't show on certain pages
  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  const currentStep = STEPS.find((s) => !s.check(state)) ?? STEPS[0];
  const currentStepNumber = STEPS.findIndex((s) => s.key === currentStep.key) + 1;

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("opensrcer-onboarding-dismissed", "1"); } catch { /* storage unavailable */ }
  }

  return (
    <div className="border-b border-border bg-surface/40">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[auto_1fr_auto_auto] sm:gap-4 sm:px-8">
        <span className="col-start-1 row-start-1 shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-signal sm:col-start-auto sm:row-start-auto">
          Step {currentStepNumber} of {STEPS.length}
        </span>

        {/* Current step */}
        <div className="col-start-1 row-start-2 min-w-0 sm:col-start-auto sm:row-start-auto">
          <span className="text-[12px] font-medium text-paper">{currentStep.title}</span>
          <span className="text-[11px] text-paper-muted ml-2 hidden sm:inline">
            — {currentStep.description}
          </span>
        </div>

        {/* CTA */}
        <Link
          href={currentStep.href}
          className="col-start-2 row-start-2 inline-flex min-h-10 shrink-0 items-center rounded-md border border-signal/50 bg-signal/10 px-3 py-2 text-xs font-medium text-signal transition hover:bg-signal/20 sm:col-start-auto sm:row-start-auto"
        >
          {currentStep.cta}
        </Link>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="col-start-2 row-start-1 shrink-0 justify-self-end px-1 text-sm text-paper-muted hover:text-paper sm:col-start-auto sm:row-start-auto"
          aria-label="Dismiss onboarding"
          title="Dismiss onboarding"
        >
          <IconClose size={15} />
        </button>
      </div>
    </div>
  );
}
