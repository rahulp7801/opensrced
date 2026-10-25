import Link from "next/link";
import { Wordmark } from "./brand/wordmark";

// ponytail: each section's first page, copied from components/nav-config.tsx
// (importing it here would pull its client-only icon library into this server
// component). Update both if a section moves. Named by page, not by section,
// so "Find"/"Fix"/"Ship"/"Explore" stay unique links (the smokes count them).
const PRODUCT = [["Browse repos", "/discover"], ["New run", "/trigger"], ["Pull requests", "/prs"], ["Codebase map", "/graph"]] as const;

// The deployed commit, read at build (Vercel sets these); "local" elsewhere.
const BUILD = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7);

/** A colophon, signed: what this is, where to go, who made it and with what.
 *  `inviteOnly`: during the private preview the source link is left out too. */
export function SiteFooter({ inviteOnly = false }: { inviteOnly?: boolean }) {
  // Plain links with a 40px tap height, so they're easy to hit on a phone.
  const link = "inline-flex min-h-10 items-center text-[14px] text-paper-dim transition-colors hover:text-paper";
  const about: [string, string, boolean][] = [
    ["Demo", "/demo", false],
    ...(inviteOnly ? [] : ([["Source", "https://github.com/rahulp7801/opensrced", true]] as [string, string, boolean][])),
    ["Privacy", "/privacy", false],
  ];
  return (
    <footer className="mt-20 border-t border-border-soft bg-ink">
      <div className="mx-auto max-w-[1320px] px-5 pt-12 sm:px-8 min-[1384px]:px-0">
        <div className="grid gap-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-16">
          <div>
            <Wordmark className="text-[24px] text-paper" />
            <p className="mt-3 max-w-[40ch] text-[15px] leading-[1.55] text-paper-muted">Careful contributions, reviewed before they ship.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-2">
            <nav aria-label="Product">
              <p className="font-mono text-[12px] text-paper-faint">Product</p>
              <ul className="mt-2">
                {PRODUCT.map(([label, href]) => (
                  <li key={label}><Link className={link} href={href}>{label}</Link></li>
                ))}
              </ul>
            </nav>
            <nav aria-label="About">
              <p className="font-mono text-[12px] text-paper-faint">About</p>
              <ul className="mt-2">
                {about.map(([label, href, external]) => (
                  <li key={label}>
                    {external ? (
                      <a className={link} href={href} target="_blank" rel="noreferrer">{label}&nbsp;<span aria-hidden className="text-[0.85em]">&#x2197;</span></a>
                    ) : (
                      <Link className={link} href={href}>{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
        <p className="mt-12 border-t border-border-soft py-5 font-mono text-[11.5px] leading-[1.7] text-paper-faint">
          Made by{" "}
          <a className="underline decoration-border-strong underline-offset-2 hover:text-paper" href="https://github.com/rahulp7801" target="_blank" rel="noreferrer">@rahulp7801</a>
          {" · "}Set in Bricolage Grotesque, Instrument Sans &amp; JetBrains Mono{" · "}build {BUILD}
        </p>
      </div>
    </footer>
  );
}
