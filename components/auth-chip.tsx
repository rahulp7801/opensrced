"use client";

/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are user-controlled. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { safeAvatarUrl } from "@/lib/avatar-url";
import { GitHubSignIn } from "./github-sign-in";
import { IconChevronDown, IconSignOut } from "./icons";

/** The header's account corner. Signed out: "Continue with GitHub". Signed
 *  in: the avatar opens a small menu (Account, Settings, Sign out). Local
 *  mode has a fixed local user and nothing to sign out of. An account
 *  waiting for a preview invite (`canUse` false) only gets Sign out: the
 *  other pages would send it back to the invite notice. */
export function AuthChip({ localMode = false, canUse = true }: { localMode?: boolean; canUse?: boolean }) {
  const { user, isLoading } = useCurrentUser(localMode);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const path = usePathname();

  // A link in the menu navigates client-side; close it on arrival.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isLoading && !localMode) {
    return (
      <div className="flex min-h-10 shrink-0 items-center px-4" aria-hidden>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-paper-faint" />
      </div>
    );
  }

  if (!user) {
    return (
      <GitHubSignIn className="btn-primary ml-2 shrink-0 gap-2 rounded-[10px] px-3.5 text-[14px]">
        <span className="hidden sm:inline">Continue with GitHub</span>
        <span className="sm:hidden">Sign in</span>
      </GitHubSignIn>
    );
  }

  const display = (localMode ? "Local workspace" : user.nickname || user.name || user.email || "Account") as string;
  const picture = localMode ? null : safeAvatarUrl(user.picture);
  const itemClass = "flex min-h-10 items-center gap-2.5 rounded-[8px] px-3 text-[14px] text-paper-dim transition hover:bg-surface-2 hover:text-paper";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account menu for ${display}`}
        className="flex min-h-10 items-center gap-2 rounded-[10px] px-2 transition hover:bg-surface"
      >
        {picture ? (
          <img src={picture} alt="" width={24} height={24} className="shrink-0 rounded-full" />
        ) : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-2 text-xs font-medium text-paper">
            {display.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[120px] truncate text-[13px] text-paper-muted lg:inline">{display}</span>
        <IconChevronDown size={13} className="text-paper-faint" />
      </button>

      {open && (
        <div id="account-menu" className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-2xl border border-border-soft bg-surface p-1.5 shadow-[0_24px_70px_rgb(0_0_0/0.14)]">
          <p className="truncate px-3 pb-2 pt-1.5 text-[12.5px] text-paper-muted">
            {localMode ? "Local development" : <>Signed in as <strong className="font-medium text-paper">{display}</strong></>}
          </p>
          <ul className="border-t border-border-soft pt-1.5">
            {canUse && (
              <>
                <li><Link href="/account" className={itemClass}>Account</Link></li>
                <li><Link href="/crucible" className={itemClass}>Settings</Link></li>
              </>
            )}
            {!localMode && (
              <li>
                <a href="/auth/logout" className={`${itemClass} hover:text-alert`}>
                  <IconSignOut size={16} /> Sign out
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
