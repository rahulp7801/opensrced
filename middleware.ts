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
import { authDisabled, unsafeAuthConfig } from "@/lib/require-session";
import { authConfigured } from "@/lib/auth-config";

const AUTH_DISABLED = authDisabled();

// Paths that must remain public regardless of auth state.
const PUBLIC_PATHS = new Set([
  // Landing page — public, explains what opensrcer is.
  "/",
  // Liveness probe — must answer without a session so container healthchecks
  // and uptime monitors work. Reports dependency presence and config mode,
  // never secrets. See app/api/health/route.ts.
  "/api/health",
  // Login page — renders before the user has a session.
  "/login",
  // Public crawler metadata must not be redirected through authentication.
  "/robots.txt",
  "/sitemap.xml",
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
  "/graph",
  "/trigger",
  "/prs",
  "/repos",
  // Settings remains an anonymous shell so SessionGate can explain how to
  // sign in. Its server-rendered organization descendants are protected.
  "/crucible",
  "/demo",
  // Public shared fix viewer + the single-fix read API behind it. The
  // enumeration endpoint that used to live at GET /api/fixes is gone — it
  // listed the most recent shares to anyone who asked, which made the
  // unguessable-link model of /fix/<id> meaningless. See app/api/fixes.
  "/fix",
  "/api/fixes",
]);

// Only these routes intentionally expose descendants. Keeping this separate
// prevents a public shell such as /repos from accidentally making a future
// server-rendered /repos/<private-data> page public too.
const PUBLIC_PREFIXES = ["/prs/", "/fix/", "/api/fixes/"];

// When Auth0 is missing, only surfaces that are useful without an account
// stay public. The authenticated client shells above normally render first
// and let SessionGate resolve the user in the browser. With no Auth0 tenant,
// that profile request can only fail and used to leave visitors waiting for
// the ten-second recovery screen. Redirect those shells straight to the
// explanatory login page instead.
const UNCONFIGURED_PUBLIC_PATHS = new Set([
  "/",
  "/api/health",
  "/login",
  "/robots.txt",
  "/sitemap.xml",
  "/demo",
  "/fix",
  "/api/fixes",
]);
const UNCONFIGURED_PUBLIC_PREFIXES = ["/fix/", "/api/fixes/"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Fail closed with a normal response. Throwing at module initialization
  // previously sent every request through Next's error renderer and caused a
  // second "headers already sent" failure.
  if (unsafeAuthConfig()) {
    return NextResponse.json(
      { error: "Authentication cannot be disabled in production." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Local mode must not touch the Auth0 SDK: by definition its configuration
  // can be absent, and SDK discovery would fail before the request reaches the
  // local session fallback.
  if (AUTH_DISABLED) {
    const response = NextResponse.next();
    response.headers.set("X-Auth", "disabled-via-env");
    return response;
  }

  // Readiness must still explain a missing Auth0 setup. Calling the SDK first
  // can fail before the health route gets a chance to report auth0_config.
  if (pathname === "/api/health") return NextResponse.next();

  // Keep the public product and diagnostic surfaces usable while a deploy is
  // being configured. Calling the Auth0 SDK with missing settings throws in
  // middleware and can leave Next trying to write two responses.
  if (!authConfigured()) {
    const publicRead = (req.method === "GET" || req.method === "HEAD") &&
      (UNCONFIGURED_PUBLIC_PATHS.has(pathname) ||
        UNCONFIGURED_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)));
    if (publicRead || pathname === "/api/crucible/github/webhook") {
      const response = NextResponse.next();
      response.headers.set("X-Auth", "not-configured");
      return response;
    }
    // Auth0's client hook treats 401 as the normal signed-out state. A 503
    // here is retried, keeping otherwise-public pages such as /demo network-
    // busy indefinitely when a preview has no tenant configured.
    if (pathname === "/auth/profile" && (req.method === "GET" || req.method === "HEAD")) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
      return NextResponse.json(
        { error: "Authentication is not configured for this deployment." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("returnTo", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // 1. Let the SDK serve /auth/* and refresh the session cookie. `authRes`
  //    holds any Set-Cookie the refresh produced — carry it forward.
  const authRes = await auth0.middleware(req);
  if (pathname === "/auth/logout") authRes.cookies.delete("opensrcer-keys");

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
