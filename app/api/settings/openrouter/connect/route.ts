// GET /api/settings/openrouter/connect?adult=1
//
// Start "Connect OpenRouter" (lib/openrouter.ts): keep a fresh PKCE verifier
// in a short-lived httpOnly cookie and send the user to OpenRouter's own
// sign-in with its S256 challenge. OpenRouter accounts are 18+, so the
// settings page asks the user to confirm that first (adult=1).

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { siteUrl } from "@/lib/site-url";
import { openRouterAuthUrl, pkcePair, PKCE_COOKIE_NAME, PKCE_COOKIE_SECONDS } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  if (req.nextUrl.searchParams.get("adult") !== "1") {
    return NextResponse.json({ error: "OpenRouter accounts are for adults (18+). Confirm your age in Settings first." }, { status: 400 });
  }

  const { verifier, challenge } = pkcePair();
  const response = NextResponse.redirect(openRouterAuthUrl(`${siteUrl()}/api/settings/openrouter/callback`, challenge));
  response.cookies.set(PKCE_COOKIE_NAME, verifier, {
    httpOnly: true,
    // Lax: the callback is a top-level navigation back from openrouter.ai.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/settings/openrouter",
    maxAge: PKCE_COOKIE_SECONDS,
  });
  return response;
}
