// POST /api/auth/revoke-all
// Stop this user's active work, disconnect their organizations, and clear
// their provider keys (lib/revoke-access.ts), then sign out.

import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { logoutUrl, revokeAccess } from "@/lib/revoke-access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const { stopped, disconnected } = await revokeAccess(sub);
    return NextResponse.json({ ok: true, stopped, disconnected, redirect: logoutUrl() });
  } catch {
    // Keep the session and connections intact when cancellation cannot be
    // recorded. The user can retry instead of receiving a false assurance.
    return NextResponse.json(
      { error: "Could not stop active work. Your connections remain available; please retry." },
      { status: 503 },
    );
  }
}
