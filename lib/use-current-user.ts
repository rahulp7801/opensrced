"use client";

import { useUser } from "@auth0/nextjs-auth0";

export function useCurrentUser(localMode = false) {
  return useUser(localMode ? { route: "/api/local-profile" } : undefined);
}
