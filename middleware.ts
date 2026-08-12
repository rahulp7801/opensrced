// Next.js middleware — mounts the Auth0 routes AND gates the site.
//
// Under SDK v4 the middleware does double duty: `auth0.middleware(req)`
// serves /auth/login, /auth/logout, /auth/callback, and /auth/profile (the
// v3 catch-all route at app/api/auth/[auth0]/route.ts is gone), and it
// rolls the session cookie. Its response carries Set-Cookie headers, so the
// gating logic below must return THAT response — returning a fresh
// NextResponse.next() instead silently drops the refreshed session and the
// user gets logged out mid-browse.
//
// Everything past the auth routes is the same policy as before: users must
// log in before any page or API route, so every GitHub operation runs as the
// logged-in user rather than the deployer's PAT.
//
// Escape hatch: AUTH_DISABLED=1 skips the gating (local dev without Auth0).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";

// Paths that must remain public regardless of auth state.
const PUBLIC_PATHS = [
  // Landing page — public, explains what opensrcer is.
  "/",
  // Liveness probe — must answer without a session so container healthchecks
  // and uptime monitors work. Reports dependency presence and config mode,
  // never secrets. See app/api/health/route.ts.
  "/api/health",
  // Login page — renders before the user has a session.
  "/login",
  // GitHub App webhook — authenticates via HMAC, not session.
  "/api/crucible/github/webhook",
  // Install callback — authenticates via nonce cookie.
  "/api/crucible/github/install-callback",
  // Client-shell pages — these render instantly as static HTML and fetch
  // data via auth-gated API routes. No need for middleware session check.
  "/discover",
  "/dispatches",
  "/issues",
  "/stats",
  "/explore",
  "/trigger",
  "/prs",
  "/repos",
  "/crucible",
  "/demo",
  // Public shared fix viewer + API
  "/fix",
  "/api/fixes",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")),
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 1. Let the SDK serve /auth/* and refresh the session cookie. `authRes`
  //    holds any Set-Cookie the refresh produced — carry it forward.
  const authRes = await auth0.middleware(req);

  // The SDK owns /auth/* entirely (login, logout, callback, profile).
  // Returning early also keeps the gate below from redirecting the login
  // route back to itself.
  if (pathname.startsWith("/auth/")) return authRes;

  // NO prefetch escape hatch. `next-router-prefetch` / `purpose: prefetch`
  // are plain request headers — any client can set them, so skipping the
  // session check on their say-so was a blanket auth bypass for every route
  // that relies on this middleware (which is most of them). Prefetches carry
  // cookies like any other request; getSession() handles them correctly and
  // costs one cookie decrypt. If prefetch latency ever regresses, narrow the
  // skip to GET page routes — never /api/*, never a mutating method.

  // Logged-in users hitting /login should be redirected to the dashboard.
  if (pathname === "/login" && !AUTH_DISABLED) {
    const session = await auth0.getSession(req);
    if (session?.user) {
      return NextResponse.redirect(new URL("/discover", req.url));
    }
    return authRes;
  }

  if (isPublic(pathname)) return authRes;

  if (AUTH_DISABLED) {
    authRes.headers.set("X-Auth", "disabled-via-env");
    return authRes;
  }

  const session = await auth0.getSession(req);
  if (session?.user) return authRes;

  // API routes get 401 JSON; pages get redirected to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("returnTo", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip middleware for static files, images, and Next.js internals.
  // Everything else must pass through — including /auth/*, which only
  // exists because auth0.middleware() serves it above.
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};
