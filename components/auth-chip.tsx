"use client";

/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are user-controlled. */

import Link from "next/link";
import { useCurrentUser } from "@/lib/use-current-user";
import { safeAvatarUrl } from "@/lib/avatar-url";
import { IconSignOut } from "./icons";

export function AuthChip({ localMode = false }: { localMode?: boolean }) {
  const { user, isLoading } = useCurrentUser(localMode);

  if (localMode) {
    return (
      <Link
        href="/crucible"
        aria-label="Local settings"
        className="ml-auto flex shrink-0 items-center gap-2 border-l border-border px-3 text-[11.5px] text-paper-muted transition hover:bg-surface-2/60 hover:text-paper"
        title="Local development mode — open settings"
      >
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
        <span className="hidden sm:inline">Local</span>
      </Link>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center border-l border-border px-4 shrink-0" aria-hidden>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-paper-faint animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <a
        href="/auth/login"
        className="flex items-center gap-2 border-l border-border px-4 text-[12px] font-medium text-paper bg-surface-2/60 hover:bg-surface-2 transition shrink-0 whitespace-nowrap"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0" aria-hidden>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Sign in
      </a>
    );
  }

  const display = (user.name || user.email || "User") as string;
  const initial = display.slice(0, 1).toUpperCase();
  const picture = safeAvatarUrl(user.picture);

  return (
    <div className="flex items-stretch shrink-0 ml-auto">
      <Link
        href="/crucible"
        aria-label={`Settings for ${display}`}
        className="flex items-center gap-2 border-l border-border px-3 hover:bg-surface-2/60 transition"
        title={`${display} — manage connections`}
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            width={22}
            height={22}
            className="rounded-full shrink-0"
          />
        ) : (
          <span className="inline-flex items-center justify-center h-[22px] w-[22px] rounded-full border border-border-strong bg-surface-2 text-xs font-medium text-paper shrink-0">
            {initial}
          </span>
        )}
        <span className="text-[11.5px] text-paper-muted max-w-[90px] truncate hidden lg:inline">
          {display}
        </span>
      </Link>
      <a
        href="/auth/logout"
        aria-label="Sign out"
        className="flex items-center gap-2 border-l border-border px-3 text-[11px] text-paper-faint hover:text-red-300 hover:bg-red-950/20 transition whitespace-nowrap"
        title="Sign out"
      >
        <IconSignOut size={16} />
        <span className="hidden sm:inline">Sign out</span>
      </a>
    </div>
  );
}
