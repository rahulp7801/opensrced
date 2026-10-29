// GET /api/settings/openrouter/callback?code=...
//
// OpenRouter sends the user back here after they approved a key. Exchange the
// code (with this browser's PKCE verifier) for the key and save it in the
// encrypted key cookie, like a pasted key. The key is never logged or echoed;
// the user lands back on Settings with a short status.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { siteUrl } from "@/lib/site-url";
import { getStoredKeys, setStoredKeys } from "@/lib/api-keys";
import { exchangeOpenRouterCode, OpenRouterAuthError, PKCE_COOKIE_NAME } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// Only a fixed result goes back in the URL: a crafted link must not be able
// to put words on the Settings page.
function back(result: "connected" | "failed") {
  const url = new URL("/crucible", siteUrl());
  url.searchParams.set("openrouter", result);
  const response = NextResponse.redirect(url);
  // Single use, whatever happened.
  response.cookies.delete({ name: PKCE_COOKIE_NAME, path: "/api/settings/openrouter" });
  return response;
}

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const code = req.nextUrl.searchParams.get("code") ?? "";
  const verifier = req.cookies.get(PKCE_COOKIE_NAME)?.value ?? "";
  // No code: the user declined on OpenRouter.
  if (!code) return back("failed");
  try {
    const key = await exchangeOpenRouterCode(code, verifier);
    await setStoredKeys({ ...(await getStoredKeys()), openrouter: key });
  } catch (error) {
    if (error instanceof OpenRouterAuthError) return back("failed");
    throw error;
  }
  return back("connected");
}
