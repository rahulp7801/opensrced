// Starts the GitHub App install flow. Generates a nonce, stashes it in an
// httpOnly cookie alongside the Auth0 user id, then redirects to GitHub's
// install page. On return the install-callback route verifies the nonce
// matches before persisting the org mapping.

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@auth0/nextjs-auth0";
import { STATE_COOKIE } from "@/lib/crucible/constants";

export const dynamic = "force-dynamic";

const APP_SLUG = process.env.GITHUB_APP_SLUG || "opensrcer-crucible";

export async function GET() {
  const session = await getSession();
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
