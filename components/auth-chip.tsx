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
        className="ml-auto flex min-h-10 shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-[13px] text-paper-muted transition hover:bg-surface hover:text-paper"
        title="Local development mode — open settings"
      >
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
        <span className="hidden sm:inline">Local</span>
      </Link>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-10 shrink-0 items-center px-4" aria-hidden>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-paper-faint" />
      </div>
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="btn-primary ml-2 shrink-0 gap-2 rounded-[10px] px-3.5 text-[14px]"
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
    <div className="flex shrink-0 items-center gap-0.5">
      <Link
        href="/crucible"
        aria-label={`Settings for ${display}`}
        className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-[10px] px-2 transition hover:bg-surface"
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
        <span className="hidden max-w-[110px] truncate text-[12.5px] text-paper-muted lg:inline">
          {display}
        </span>
      </Link>
      <a
        href="/auth/logout"
        aria-label="Sign out"
        className="flex min-h-10 min-w-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-2.5 text-paper-muted transition hover:bg-surface hover:text-alert"
        title="Sign out"
      >
        <IconSignOut size={17} />
      </a>
    </div>
  );
}
