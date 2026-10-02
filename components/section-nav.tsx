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
import { cn } from "@/lib/utils";
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
    <nav aria-label={`${section.label} section`} className="border-b border-border-soft bg-ink/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex min-h-[52px] w-full max-w-[1200px] items-center gap-1 overflow-x-auto px-5 sm:px-8">
        <span className="mr-auto hidden shrink-0 pr-4 text-[19px] font-semibold tracking-[-0.02em] text-paper sm:inline">
          {section.label}
        </span>
        {section.links.map((link) => {
          const active = isLinkActive(path, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={link.title}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors",
                active
                  ? "bg-surface-3 font-medium text-paper"
                  : "text-paper-muted hover:text-paper",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
