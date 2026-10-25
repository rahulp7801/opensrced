"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, isLinkActive } from "./nav-config";

/** The four task sections as plain text beside the wordmark. The current one
 *  is ink with a 2px ink rule sitting on the header's bottom hairline. */
export function Nav() {
  const path = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex min-w-0 items-stretch gap-3 sm:gap-7">
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
            className="tab-link min-w-0 text-[14px]"
          >
            <span className="truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
