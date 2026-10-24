"use client";

import { useEffect, useState } from "react";
import { useCanUseApp } from "@/lib/use-current-user";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconClose } from "@/components/icons";
import { paymentSummary } from "@/lib/beginner-guide";

type OnboardingState = {
  hasKey: boolean;
  hasDispatch: boolean;
  /** Why a run needs paying for and what it costs, from this deployment's settings. */
  payment: string;
};

// Used when the settings answer lacks the fields paymentSummary needs.
const PAYMENT_FALLBACK = "The agent is an AI model, so each run costs a little. Settings shows the ways this deployment can pay for it and lets you cap each run. Finding and checking issues is free.";

const STEPS = [
  {
    key: "key" as const,
    title: "Set up how the AI agent is paid for",
    description: (s: OnboardingState) => s.payment,
    href: "/crucible",
    cta: "Set up payment",
    check: (s: OnboardingState) => s.hasKey,
  },
  {
    key: "dispatch" as const,
    title: "Pick a beginner-friendly issue",
    description: () => "Start with a suggested good first issue: unassigned, with no pull request linked. A run stops for your review; nothing is posted until you confirm.",
    href: "/issues",
    cta: "Find an issue",
    check: (s: OnboardingState) => s.hasDispatch,
  },
];

// Don't show onboarding on these pages — they're where the user
// completes the steps, so showing the prompt would be redundant.
// Key-required pages already show the persistent ApiKeyGate. Keeping onboarding
// off them avoids two banners with two buttons for the same settings page.
const HIDDEN_ON = ["/crucible", "/login", "/", "/trigger", "/explore"];

export function Onboarding({ localMode = false, inviteOnly = false }: { localMode?: boolean; inviteOnly?: boolean }) {
  // `user` here means "may use the app": an account without a preview invite gets no setup prompts.
  const { canUse } = useCanUseApp(localMode, inviteOnly);
  const user = canUse;
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const hidden = HIDDEN_ON.some((path) => pathname === path || pathname.startsWith(path + "/"));

  useEffect(() => {
    if (hidden || (!user && !localMode)) return;
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
        const data = await response.json() as { anthropic?: unknown; ready?: unknown; offered?: unknown; maxSpendUsd?: unknown };
        let payment = PAYMENT_FALLBACK;
        if (Array.isArray(data.offered) && typeof data.maxSpendUsd === "number") {
          try { payment = paymentSummary({ offered: data.offered.filter((p): p is string => typeof p === "string"), maxSpendUsd: data.maxSpendUsd }); }
          catch (error) { if (!(error instanceof RangeError)) throw error; }
        }
        return { hasKey: (data.ready ?? data.anthropic) === true, payment };
      }),
      fetch("/api/dispatches", { signal }).then(async (response) => {
        if (!response.ok) throw new Error("Runs unavailable");
        const data = await response.json() as { dispatches?: unknown };
        if (!Array.isArray(data.dispatches)) throw new Error("Invalid runs response");
        return data.dispatches.length > 0;
      }),
    ]).then(([{ hasKey, payment }, hasDispatch]) => {
      if (!controller.signal.aborted) setState({ hasKey, hasDispatch, payment });
    }).catch(() => {
      // Do not turn a service failure into incorrect setup guidance.
    });
    return () => controller.abort();
  }, [user, localMode, hidden]);

  if ((!user && !localMode) || !state || dismissed) return null;

  // All done — don't show
  const allDone = STEPS.every((s) => s.check(state));
  if (allDone) return null;

  // Don't show on certain pages
  if (hidden) return null;

  const currentStep = STEPS.find((s) => !s.check(state)) ?? STEPS[0];
  const currentStepNumber = STEPS.findIndex((s) => s.key === currentStep.key) + 1;

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("opensrcer-onboarding-dismissed", "1"); } catch { /* storage unavailable */ }
  }

  return (
    <aside aria-label="Account setup" className="border-b border-border bg-surface/40">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[auto_1fr_auto_auto] sm:gap-4 sm:px-8">
        <span className="col-start-1 row-start-1 shrink-0 text-[11px] font-medium font-medium text-signal sm:col-start-auto sm:row-start-auto">
          Step {currentStepNumber} of {STEPS.length}
        </span>

        {/* Current step */}
        <div className="col-start-1 row-start-2 min-w-0 sm:col-start-auto sm:row-start-auto">
          <span className="text-[12px] font-medium text-paper">{currentStep.title}</span>
          {/* Shown on phones too: the why matters more than the title. */}
          <span className="mt-0.5 block text-[11px] leading-relaxed text-paper-muted sm:ml-2 sm:mt-0 sm:inline">
            <span aria-hidden className="hidden sm:inline">— </span>{currentStep.description(state)}
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
    </aside>
  );
}
