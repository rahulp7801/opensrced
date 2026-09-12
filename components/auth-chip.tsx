"use client";

/* eslint-disable @next/next/no-img-element -- OAuth avatar hosts are user-controlled. */

import Link from "next/link";
import { GithubLogo } from "@phosphor-icons/react";
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
      <Link
        href="/login"
        className="flex shrink-0 items-center gap-2 px-4 text-[12px] font-medium text-paper-dim transition hover:text-paper whitespace-nowrap"
      >
        <GithubLogo aria-hidden size={17} weight="fill" />
        Sign in
      </Link>
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
