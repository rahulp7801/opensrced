"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SECTIONS, isLinkActive } from "./nav-config";

export function Nav() {
  const path = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex items-stretch flex-1 min-w-0">
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
            aria-label={section.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex min-w-0 items-center justify-center gap-1 px-1.5 transition-colors sm:gap-2 sm:px-5",
              "hover:bg-surface-2/60",
              active ? "bg-surface-2/80" : "bg-transparent",
            )}
          >
            <Icon
              className={cn(
                "hidden shrink-0 sm:block",
                active ? "text-signal" : "text-paper-muted group-hover:text-paper",
              )}
            />
            <span
              className={cn(
                "truncate text-[11.5px] font-medium tracking-tight sm:text-[14px]",
                active ? "text-paper" : "text-paper-dim group-hover:text-paper",
              )}
            >
              {section.label}
            </span>
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
