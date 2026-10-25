"use client";

import { usePathname } from "next/navigation";
import { sectionFor } from "./nav-config";

/** Every app page opens the same way: a cobalt kicker naming what the
 *  section is for (from nav-config, so it always matches the nav), a
 *  display-type title (sentence case, tight leading), and a quiet description.
 *  Pages outside a section can pass their own kicker. */
export function PageHeading({
  title,
  kicker,
  description,
  actions,
}: {
  title: React.ReactNode;
  kicker?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const label = kicker ?? sectionFor(pathname)?.title;
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pt-2 sm:mb-12 sm:pt-6">
      <div className="min-w-0 max-w-3xl">
        {label && <p className="kicker mb-3 text-signal sm:mb-4">{label}</p>}
        <h1 className="display text-[44px] leading-[0.95] tracking-[-0.025em] text-paper sm:text-[64px]">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-2xl text-[16px] leading-[1.6] text-paper-muted sm:mt-5 sm:text-[17px]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
