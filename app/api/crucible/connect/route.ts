// Starts the GitHub App install flow. Generates a nonce, stashes it in an
// httpOnly cookie alongside the Auth0 user id, then redirects to GitHub's
// install page. On return the install-callback route verifies the nonce
// matches before persisting the org mapping.

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { STATE_COOKIE } from "@/lib/crucible/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  // No default slug: a fallback would send org admins to install whichever
  // app owns that name, granting it private-repo access.
  const APP_SLUG = process.env.GITHUB_APP_SLUG;
  if (!APP_SLUG) {
    return NextResponse.json({ error: "Organization connections are not configured for this deployment." }, { status: 503 });
  }
  const session = await auth0.getSession();
  const user = session?.user;
  if (!user?.sub) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const nonce = crypto.randomBytes(24).toString("hex");
  // Cookie carries both the nonce and the Auth0 sub so the callback can
  // re-identify the user without relying on the session surviving the
  // cross-site redirect to GitHub and back.
  const payload = Buffer.from(
    JSON.stringify({ nonce, sub: user.sub, ts: Date.now() })
  ).toString("base64url");

  const installUrl = `https://github.com/apps/${APP_SLUG}/installations/new?state=${nonce}`;
  const res = NextResponse.redirect(installUrl);
  res.cookies.set(STATE_COOKIE, payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10-min window to complete install
  });
  return res;
}
