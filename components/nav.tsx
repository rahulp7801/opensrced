"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, isLinkActive } from "./nav-config";

/** The four task sections as pills; the current one is inked in (.pill[aria-current]). */
export function Nav() {
  const path = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:gap-1.5">
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
            // Quiet (no fill) until hovered or current, so four fit on a phone.
            data-quiet
            className="pill min-w-0 px-2.5 text-[13.5px] sm:px-4 sm:text-[14px]"
          >
            <span className="truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
