"use client";

import { usePathname } from "next/navigation";
import { isLinkActive, sectionFor } from "./nav-config";

/** Every app page opens the same way: a mono path line saying where you are
 *  ("find / issues", from nav-config so it always matches the nav), a
 *  display-type title, and a one-sentence lede that sits beside the title on
 *  wide screens (5fr / 6fr) and under it on phones. Pages outside a section
 *  pass their own `path`. No cobalt here: the page's one cobalt thing is
 *  further down, where the work is. */
export function PageHeading({
  title,
  path,
  kicker,
  description,
  actions,
}: {
  title: React.ReactNode;
  /** The mono path line, e.g. "account / settings". */
  path?: React.ReactNode;
  /** Older name for `path`. */
  kicker?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const section = sectionFor(pathname);
  const link = section?.links.find((l) => isLinkActive(pathname, l.href));
  const crumb = path ?? kicker ?? (section && link ? `${section.label} / ${link.label}`.toLowerCase() : null);
  return (
    <header className="mb-10 pt-2 sm:pt-6">
      {crumb && <p className="mb-3 font-mono text-[12px] tracking-[0.02em] text-paper-faint">{crumb}</p>}
      <div className="grid gap-x-12 gap-y-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-end">
        {/* 700 (lighter than .display's 750) at this size: a title, not a poster. */}
        <h1 className="display text-[40px] leading-[1.02] tracking-[-0.02em] text-paper sm:text-[44px]" style={{ fontWeight: 700 }}>
          {title}
        </h1>
        {(description || actions) && (
          <div className="min-w-0">
            {description && (
              <p className="max-w-[52ch] text-[16px] leading-[1.55] text-paper-muted sm:text-[17px]">
                {description}
              </p>
            )}
            {actions && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{actions}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
