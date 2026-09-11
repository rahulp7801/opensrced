// POST /api/auth/revoke-all
// Disconnect this user from all organizations and clear their provider keys.
// Existing running jobs and the GitHub App installation are not revoked.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { listOrgsFor, deleteMappingsForUser } from "@/lib/crucible/orgs";
import { clearStoredKeys } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // 1. Delete all org mappings for this user
  const orgs = await listOrgsFor(sub);
  await deleteMappingsForUser(sub);

  // 2. Clear stored API keys
  await clearStoredKeys();

  // 3. Redirect to Auth0 logout (destroys the session cookie).
  //    APP_BASE_URL is the v4 name; AUTH0_BASE_URL is the v3 spelling, kept
  //    as a fallback to match lib/auth0.ts.
  const baseUrl =
    process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || "http://localhost:3000";
  const logoutUrl = `/auth/logout?returnTo=${encodeURIComponent(baseUrl + "/login")}`;
  return NextResponse.json({ ok: true, disconnected: orgs.length, redirect: logoutUrl });
}
