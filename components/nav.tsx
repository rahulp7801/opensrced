"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SECTIONS, isLinkActive } from "./nav-config";

export function Nav() {
  const path = usePathname();

  return (
    <nav className="flex items-stretch flex-1 min-w-0">
      {SECTIONS.map((section) => {
        const active = section.links.some((l) => isLinkActive(path, l.href));
        const { Icon } = section;
        return (
          <Link
            key={section.label}
            // A section lands on its first page; the sub-tabs take it from
            // there. See components/section-nav.tsx.
            href={section.links[0].href}
            title={section.title}
            className={cn(
              "group relative flex items-center justify-center gap-2 border-r border-border px-5 transition-colors min-w-0",
              "hover:bg-surface-2/60",
              active ? "bg-surface-2/80" : "bg-transparent",
            )}
          >
            <Icon
              className={cn(
                "shrink-0",
                active ? "text-signal" : "text-paper-muted group-hover:text-paper",
              )}
            />
            {/* Four items fit their labels far earlier than ten did, so the
                label survives down to sm instead of vanishing below xl and
                leaving a row of near-identical glyphs. */}
            <span
              className={cn(
                "text-[12.5px] tracking-tight hidden sm:inline truncate",
                active ? "text-paper" : "text-paper-dim group-hover:text-paper",
              )}
            >
              {section.label}
            </span>
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-signal signal-glow" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
