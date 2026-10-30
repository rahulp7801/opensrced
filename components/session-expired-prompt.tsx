"use client";

import { useEffect, useState } from "react";
import { watchUnauthorized } from "@/lib/session-expired";
import { GitHubSignIn } from "./github-sign-in";
import { IconClose } from "./icons";

/** The app-wide answer to an expired session: any /api/ request that comes
 *  back 401 (lib/session-expired.ts) opens this prompt, which signs in again
 *  and returns to this page. What the user typed stays on the page; the
 *  prompt only covers a strip at the bottom. Not mounted in local mode. */
export function SessionExpiredPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = watchUnauthorized(original, window.location.origin, () => setOpen(true));
    return () => { window.fetch = original; };
  }, []);

  if (!open) return null;
  return (
    <div role="alertdialog" aria-labelledby="session-expired-title" aria-describedby="session-expired-body" className="fixed inset-x-0 bottom-0 z-50 border-t border-border-soft bg-surface shadow-[0_-12px_40px_rgb(0_0_0/0.12)]">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-8">
        <div className="min-w-0 flex-1">
          <p id="session-expired-title" className="text-[15px] font-semibold text-paper">Your session has expired</p>
          <p id="session-expired-body" className="mt-0.5 text-[14px] leading-[1.5] text-paper-muted">Sign in again to keep going. You&apos;ll come back to this page.</p>
        </div>
        <GitHubSignIn className="btn-primary min-h-11 gap-2 px-5 text-[15px]" />
        <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" title="Dismiss" className="grid size-10 place-items-center rounded-full text-paper-muted hover:bg-surface-2 hover:text-paper">
          <IconClose size={15} />
        </button>
      </div>
    </div>
  );
}
