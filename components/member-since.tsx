"use client";

import { useSwrFetch } from "@/lib/use-swr-fetch";

/** "Member since" from the account's users row (GET /api/me records it on
 *  first call). Read in the browser: /account does no database work while
 *  rendering. */
export function MemberSince() {
  const { data, isLoading } = useSwrFetch<{ createdAt: string | null }>("/api/me");
  if (isLoading) return <span className="text-paper-faint">Member since …</span>;
  if (!data?.createdAt) return <>Member since: not recorded on this deployment</>;
  return <>Member since {new Date(data.createdAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" })}</>;
}
