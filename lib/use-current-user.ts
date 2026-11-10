"use client";

import { useUser } from "@auth0/nextjs-auth0";
import { useSwrFetch } from "@/lib/use-swr-fetch";

export function useCurrentUser(localMode = false) {
  return useUser(localMode ? { route: "/api/local-profile" } : undefined);
}

/** Whether the visitor can use the app, not just whether they are signed in.
 *  In the invite-only preview (lib/access.ts) a signed-in account also needs
 *  an invite; the server answers that at /api/access, asked only in that mode. */
export function useCanUseApp(localMode = false, inviteOnly = false) {
  const { user, isLoading } = useCurrentUser(localMode);
  const { data } = useSwrFetch<{ invited: boolean; student?: boolean }>(inviteOnly && user && !localMode ? "/api/access" : null);
  const canUse = localMode || (Boolean(user) && (!inviteOnly || data?.invited === true));
  // `student`: in a class, so using the plugin rather than the site's hosted runs.
  return { user, isLoading, canUse, student: data?.student === true };
}
