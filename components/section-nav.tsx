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
import { useUser } from "@auth0/nextjs-auth0";
import { cn } from "@/lib/utils";
import { isLinkActive, sectionFor } from "./nav-config";

export function SectionNav() {
  const path = usePathname();
  const { user } = useUser();
  const section = sectionFor(path);
  // Gated on the session to match the primary nav in components/header.tsx —
  // a signed-out visitor should not get section chrome for pages whose data
  // they cannot load.
  if (!user || !section || section.links.length < 2) return null;

  return (
    // Not sticky on its own — app/layout.tsx sticks the header and this bar
    // together as one unit, so neither needs to know the other's height.
    <div className="border-b border-border-soft bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-1 px-4 sm:px-6">
        <span className="mono-label mr-2 hidden shrink-0 py-2.5 sm:inline">
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
                "relative whitespace-nowrap px-3 py-2.5 text-[12.5px] transition-colors",
                active
                  ? "text-paper"
                  : "text-paper-muted hover:text-paper",
              )}
            >
              {link.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-signal" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
