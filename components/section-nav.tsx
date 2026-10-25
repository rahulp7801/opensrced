"use client";

// Second-level tabs: which page within the current section.
//
// Mounted once in app/layout.tsx rather than added to each page, so the
// eight pages in the IA did not have to change at all. Renders nothing for
// routes outside a section (landing, login, settings, the public /fix/<id>
// viewer) and nothing for a section with a single page — a tab bar with one
// tab is furniture, not navigation.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { isLinkActive, sectionFor } from "./nav-config";

export function SectionNav({ localMode = false }: { localMode?: boolean }) {
  const path = usePathname();
  const { user } = useCurrentUser(localMode);
  const section = sectionFor(path);
  // Gated on the session to match the primary nav in components/header.tsx —
  // a signed-out visitor should not get section chrome for pages whose data
  // they cannot load.
  if ((!user && !localMode) || !section || section.links.length < 2) return null;

  return (
    // Not sticky on its own — app/layout.tsx sticks the header and this bar
    // together as one unit, so neither needs to know the other's height.
    // A minimal text tab strip until the pages carry their own sub-tabs under
    // the title; then this component and its line in app/layout.tsx go.
    <nav aria-label={`${section.label} section`} className="border-b border-border-soft bg-ink">
      <div className="mx-auto flex min-h-11 w-full max-w-[1320px] items-stretch gap-6 overflow-x-auto px-4 sm:px-6 min-[1384px]:px-0">
        {section.links.map((link) => {
          const active = isLinkActive(path, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={link.title}
              aria-current={active ? "page" : undefined}
              className="tab-link text-[13.5px]"
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
