"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Shown when middleware sent a signed-in account without an invite back to
 *  the preview page (/?access=invite-only). Read on the client so the page
 *  itself stays static. */
export function InviteNotice() {
  const params = useSearchParams();
  if (params.get("access") !== "invite-only") return null;
  return (
    <p role="status" className="mt-6 max-w-[52ch] rounded-[14px] border border-border bg-surface px-4 py-3 text-[15px] leading-[1.55] text-paper">
      You&apos;re signed in, but opensrcer is open to invited accounts only for now. <Link href="/join" className="text-link">Ask for early access</Link> and you&apos;ll get in with this GitHub account.
    </p>
  );
}
