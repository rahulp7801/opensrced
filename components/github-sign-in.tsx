"use client";

import { usePathname } from "next/navigation";
import { GithubLogo } from "@phosphor-icons/react";
import { signInHref } from "@/lib/safe-return-to";

/** The one way the app offers sign-in: straight to GitHub (no Auth0 provider
 *  screen), then back to `returnTo`, or to the page it was clicked on. The
 *  query string is read at click time so the server-rendered link needs no
 *  Suspense boundary for useSearchParams. Style it per placement with
 *  `className`; the default is the full-size primary button. */
export function GitHubSignIn({
  returnTo,
  className = "btn-primary min-h-12 gap-3 px-6 text-[16px]",
  icon = true,
  children = "Continue with GitHub",
}: {
  returnTo?: string;
  className?: string;
  icon?: boolean;
  children?: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  return (
    <a
      href={signInHref(returnTo ?? path)}
      onClick={returnTo === undefined
        ? (event) => { event.currentTarget.href = signInHref(location.pathname + location.search + location.hash); }
        : undefined}
      className={className}
    >
      {icon && <GithubLogo aria-hidden size={18} weight="fill" className="shrink-0" />}
      {children}
    </a>
  );
}
