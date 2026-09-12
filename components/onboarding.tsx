"use client";

import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0";
import { usePathname } from "next/navigation";
import Link from "next/link";

type OnboardingState = {
  hasKey: boolean;
  hasDispatch: boolean;
};

const STEPS = [
  {
    key: "key" as const,
    number: "1",
    title: "Add an Anthropic API key",
    description: "Add the provider key used for agent runs. You can add Gemini later for patch review.",
    href: "/crucible",
    cta: "Go to Settings",
    check: (s: OnboardingState) => s.hasKey,
  },
  {
    key: "dispatch" as const,
    number: "2",
    title: "Fix your first issue",
    description: "Go to Discover, pick a repo with open issues, then click 'Fix this issue' to watch the AI agent work.",
    href: "/discover",
    cta: "Discover issues",
    check: (s: OnboardingState) => s.hasDispatch,
  },
];

// Don't show onboarding on these pages — they're where the user
// completes the steps, so showing the prompt would be redundant.
const HIDDEN_ON = ["/crucible", "/login", "/"];

export function Onboarding() {
  const { user } = useUser();
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem("opensrcer-onboarding-dismissed") === "1") {
      setDismissed(true);
      return;
    }

    // Only required first-run tasks belong here. Organization access is
    // optional for people working with public repositories.
    Promise.all([
      fetch("/api/settings/keys").then((r) => r.json()).then((d: { anthropic?: boolean }) => Boolean(d.anthropic)).catch(() => false),
      fetch("/api/dispatches").then((r) => r.json()).then((d: { dispatches?: unknown[] }) => (d.dispatches?.length ?? 0) > 0).catch(() => false),
    ]).then(([hasKey, hasDispatch]) => {
      setState({ hasKey, hasDispatch });
    });
  }, [user]);

  if (!user || !state || dismissed) return null;

  // All done — don't show
  const allDone = STEPS.every((s) => s.check(state));
  if (allDone) return null;

  // Don't show on certain pages
  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  const currentStep = STEPS.find((s) => !s.check(state)) ?? STEPS[0];

  function dismiss() {
    setDismissed(true);
    sessionStorage.setItem("opensrcer-onboarding-dismissed", "1");
  }

  return (
    <div className="border-b border-border bg-surface/40">
      <div className="mx-auto flex max-w-[1200px] items-center gap-4 px-5 py-3 sm:px-8">
        {/* Step indicators */}
        <div className="flex items-center gap-1.5 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <div className="w-3 h-px bg-border" />}
              <span
                className={`inline-flex items-center justify-center w-5 h-5 text-[10px] border ${
                  s.check(state)
                    ? "border-ok/40 text-ok bg-ok/10"
                    : s.key === currentStep.key
                      ? "border-signal/40 text-signal bg-signal/10"
                      : "border-border text-paper-faint"
                }`}
              >
                {s.check(state) ? "✓" : s.number}
              </span>
            </div>
          ))}
        </div>

        {/* Current step */}
        <div className="flex-1 min-w-0">
          <span className="text-[12px] text-paper">{currentStep.title}</span>
          <span className="text-[11px] text-paper-muted ml-2 hidden sm:inline">
            — {currentStep.description}
          </span>
        </div>

        {/* CTA */}
        <Link
          href={currentStep.href}
          className="shrink-0 rounded-md border border-signal/50 bg-signal/10 px-3 py-2 text-xs font-medium text-signal transition hover:bg-signal/20"
        >
          {currentStep.cta}
        </Link>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="shrink-0 px-1 text-sm text-paper-muted hover:text-paper"
          aria-label="Dismiss onboarding"
          title="Dismiss onboarding"
        >
          ×
        </button>
      </div>
    </div>
  );
}
