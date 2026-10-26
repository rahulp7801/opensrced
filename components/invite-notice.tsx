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
    <p role="status" className="mx-auto mt-6 max-w-[460px] text-[15px] leading-relaxed text-paper-dim">
      You&apos;re signed in, but opensrcer is open to invited accounts only for now. <Link href="/join" className="text-link">Ask for early access</Link> and you&apos;ll get in with this GitHub account.
    </p>
  );
}
