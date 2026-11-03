"use client";

import Link from "next/link";
import { useCanUseApp } from "@/lib/use-current-user";

// ponytail: each section's first page, copied from components/nav-config.tsx
// (importing it would pull its icon library into the footer). Update both if a
// section moves. Named by page, not by section, so "Find"/"Fix"/"Ship"/"Explore"
// stay unique links (the smokes count them).
const PRODUCT = [["Browse repos", "/discover"], ["New run", "/trigger"], ["Pull requests", "/prs"], ["Codebase map", "/graph"]] as const;
// Visitors who can't open the app get its two doors instead of four links to the sign-in wall.
const VISITOR = [["Join the waitlist", "/join"], ["Sign in", "/login"]] as const;

export function FooterProduct({ link, localMode, inviteOnly }: { link: string; localMode: boolean; inviteOnly: boolean }) {
  const { canUse } = useCanUseApp(localMode, inviteOnly);
  return (
    <ul className="mt-2">
      {(canUse ? PRODUCT : VISITOR).map(([label, href]) => (
        <li key={label}><Link className={link} href={href}>{label}</Link></li>
      ))}
    </ul>
  );
}
