// POST /api/auth/revoke-all
// Nuclear option: deletes ALL org mappings for the current user, clears
// all cached tokens, then redirects to Auth0 logout (which destroys the
// session). After this, the user is fully disconnected — no tokens, no
// mappings, no session.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { listOrgsFor, deleteByInstallationId } from "@/lib/crucible/orgs";
import { clearStoredKeys } from "@/lib/api-keys";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // 1. Delete all org mappings for this user
  const orgs = listOrgsFor(sub);
  for (const org of orgs) {
    // Clear cached token
    const cachePath = path.join(process.cwd(), ".dispatches", "crucible-tokens-cache.json");
    try {
      const raw = fs.readFileSync(cachePath, "utf8");
      const cache = JSON.parse(raw) as Record<string, unknown>;
      delete cache[String(org.installation_id)];
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    } catch { /* no cache */ }

    // Delete the mapping
    deleteByInstallationId(org.installation_id);
  }

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
