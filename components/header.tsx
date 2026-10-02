"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/lib/use-current-user";
import { Nav } from "./nav";
import { AuthChip } from "./auth-chip";
import { IconClose, IconHelp } from "./icons";

export function SiteHeader({ localMode = false }: { localMode?: boolean }) {
  const { user } = useCurrentUser(localMode);
  const signedIn = Boolean(user) || localMode;
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHelpOpen(false);
        requestAnimationFrame(() => helpButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        helpDialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen]);

  function closeHelp() {
    setHelpOpen(false);
    requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  return (
    <>
      {/* Stickiness lives on the wrapper in app/layout.tsx, which pins this
          header and the section tab bar together. */}
      <header className="border-b border-border-soft bg-ink/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex min-h-12 w-full max-w-[1200px] items-stretch px-2 sm:px-5">
          <Link
            href={signedIn ? "/discover" : "/"}
            aria-label="opensrcer home"
            className="group flex shrink-0 items-center gap-2 px-3 py-2"
          >
            <Mark />
            <span className={`${signedIn ? "hidden md:inline" : ""} whitespace-nowrap text-[17px] font-semibold leading-none tracking-[-0.02em] text-paper`}>
              opensrcer
            </span>
          </Link>

          {signedIn ? <Nav /> : <nav aria-label="Main navigation" className="ml-auto flex items-center gap-5 px-4 text-[13px]"><Link href="/demo" className="text-paper-dim transition-colors hover:text-paper">Demo</Link></nav>}

          {signedIn && (
            <button
              ref={helpButtonRef}
              onClick={() => setHelpOpen(!helpOpen)}
              aria-label="Open help"
              aria-expanded={helpOpen}
              aria-controls="quick-help-dialog"
              className="flex items-center justify-center px-3 text-paper-muted transition hover:text-paper"
              title="Help & quick reference"
            >
              <IconHelp size={17} />
            </button>
          )}

          <AuthChip localMode={localMode} />
        </div>
      </header>

      {/* Help panel */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={closeHelp}>
          <div
            ref={helpDialogRef}
            id="quick-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-help-title"
            className="mt-14 mr-4 max-h-[80vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border-soft bg-surface shadow-[0_24px_70px_rgb(0_0_0/0.14)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
              <span id="quick-help-title" className="text-[15px] font-semibold text-paper">Quick help</span>
              <button
                ref={closeButtonRef}
                onClick={closeHelp}
                className="inline-flex items-center justify-center text-paper-faint hover:text-paper"
                aria-label="Close help"
                title="Close help"
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4 text-[12px]">
              {/* The "Key pages" list that used to sit here explained what
                  each of the ten nav items meant. The nav is four task-named
                  sections now (components/nav-config.tsx) and says so itself,
                  so the list was restating the navigation. What remains is
                  the part navigation cannot express: the order to do things
                  in, and the two shortcuts tables. */}
              <HelpSection title="Getting started">
                <p className="text-paper-dim">1. Add your Anthropic API key in <Link href="/crucible" className="text-signal hover:underline" onClick={() => setHelpOpen(false)}>Settings</Link>, behind your avatar</p>
                <p className="text-paper-dim">2. <strong className="text-paper">Find</strong> — browse repos or issues and pick one</p>
                <p className="text-paper-dim">3. <strong className="text-paper">Fix</strong> — start a run and watch it work</p>
                <p className="text-paper-dim">4. <strong className="text-paper">Ship</strong> — review the draft PR it opened</p>
              </HelpSection>
              <HelpSection title="PR review shortcuts">
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <span className="text-paper-faint">j / k</span><span className="text-paper-dim">next / prev comment</span>
                  <span className="text-paper-faint">f</span><span className="text-paper-dim">fix focused comment</span>
                  <span className="text-paper-faint">r</span><span className="text-paper-dim">reply to comment</span>
                  <span className="text-paper-faint">d</span><span className="text-paper-dim">toggle diff</span>
                  <span className="text-paper-faint">Esc</span><span className="text-paper-dim">close panels</span>
                </div>
              </HelpSection>
              <HelpSection title="Fix modes">
                <p className="text-paper-dim"><strong className="text-ok">Quick</strong> — Uses focused file context for straightforward fixes.</p>
                <p className="text-paper-dim"><strong className="text-signal">Deep</strong> — Explores the repository for complex or multi-file fixes.</p>
              </HelpSection>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-paper-muted">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** A branch leaving the trunk: an issue becoming a pull request. */
function Mark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 32 32"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor" className="text-paper" />
      <path d="M12 9v14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 18c0-4 2-6 8-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="21" cy="12" r="2.6" fill="#fff" />
    </svg>
  );
}
