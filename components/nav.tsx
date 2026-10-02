"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SECTIONS, isLinkActive } from "./nav-config";

export function Nav() {
  const path = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex min-w-0 flex-1 items-stretch justify-center">
      {SECTIONS.map((section) => {
        const active = section.links.some((l) => isLinkActive(path, l.href));
        return (
          <Link
            key={section.label}
            // A section lands on its first page; the sub-tabs take it from
            // there. See components/section-nav.tsx.
            href={section.links[0].href}
            title={section.title}
            aria-label={section.label}
            aria-current={active ? "page" : undefined}
            className="group flex min-w-0 items-center justify-center px-2 sm:px-4"
          >
            <span
              className={cn(
                "truncate text-[13px] transition-colors",
                active ? "font-medium text-paper" : "text-paper-muted group-hover:text-paper",
              )}
            >
              {section.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
