"use client";

import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0/client";
import { Nav } from "./nav";
import { AuthChip } from "./auth-chip";

export function SiteHeader() {
  const { user } = useUser();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-ink/85 backdrop-blur-md">
      <div className="flex items-stretch w-full">
        <Link
          href={user ? "/discover" : "/"}
          className="group flex items-center gap-3 border-r border-border px-5 py-3 shrink-0"
        >
          <Mark />
          <span className="serif text-[20px] text-paper tracking-tight whitespace-nowrap">
            opensrcer
          </span>
        </Link>

        {user && <Nav />}

        <AuthChip />
      </div>
    </header>
  );
}

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
      <circle cx="16" cy="16" r="9" stroke="currentColor" className="text-paper-muted" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" className="text-signal" />
    </svg>
  );
}
