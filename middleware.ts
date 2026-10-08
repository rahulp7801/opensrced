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
  // What the app stores; must be readable before signing in.
  "/privacy",
  // Public crawler metadata must not be redirected through authentication.
  "/robots.txt",
  "/sitemap.xml",
  // Generated share card and home-screen icon (app/opengraph-image.tsx,
  // app/apple-icon.tsx). They have no file extension, so the static-file
  // exemption in the matcher below does not cover them.
  "/opengraph-image",
  "/apple-icon",
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
  "/privacy",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/apple-icon",
  "/demo",
  "/fix",
  "/api/fixes",
]);
const UNCONFIGURED_PUBLIC_PREFIXES = ["/fix/", "/api/fixes/"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** A browser write from another origin. SameSite=Lax already keeps the session
 *  cookie off cross-site POSTs, but a sibling subdomain on a custom domain is
 *  "same-site"; browsers send Origin on every cross-origin write, so checking
 *  it closes that gap. Server-to-server calls (the GitHub webhook) send none. */
function crossOriginWrite(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  // Compare with the host the browser addressed (as Next does for Server
  // Actions): req.nextUrl reflects the bind address, not preview or alias
  // hostnames. A reverse proxy may pass its upstream address as Host, so the
  // configured public origin (APP_BASE_URL) also counts. "null" (sandboxed
  // frames) is never same-origin.
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return true; }
  const hosts = [req.headers.get("x-forwarded-host")?.split(",")[0].trim(), req.headers.get("host")];
  try { if (process.env.APP_BASE_URL) hosts.push(new URL(process.env.APP_BASE_URL).host); } catch {}
  return !hosts.includes(originHost);
}

/** Local no-auth mode serves the operator's GITHUB_TOKEN to anyone who can
 *  reach it. DNS rebinding (an attacker domain resolving to 127.0.0.1) would
 *  make a web page same-origin with it, so only loopback Host names pass. */
function loopbackHost(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

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

  if (pathname.startsWith("/api/") && crossOriginWrite(req)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Local mode must not touch the Auth0 SDK: by definition its configuration
  // can be absent, and SDK discovery would fail before the request reaches the
  // local session fallback.
  if (AUTH_DISABLED) {
    if (!loopbackHost(req)) {
      return NextResponse.json({ error: "Local mode only answers on localhost." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
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
    // Same signed-out answer the configured SDK gives (204 → user null). A
    // 503 here is retried, keeping otherwise-public pages such as /demo
    // network-busy indefinitely when a preview has no tenant configured.
    if (pathname === "/auth/profile" && (req.method === "GET" || req.method === "HEAD")) {
      return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
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

  // The SDK forwards any extra /auth/login query parameter to Auth0's
  // /authorize, so a crafted link could request broader GitHub scopes
  // (connection_scope=repo,delete_repo...). Only returnTo is ours.
  if (pathname === "/auth/login" && [...req.nextUrl.searchParams.keys()].some((key) => key !== "returnTo")) {
    const clean = new URL("/auth/login", req.url);
    const returnTo = req.nextUrl.searchParams.get("returnTo");
    if (returnTo) clean.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(clean);
  }

  // Logout is a GET the SDK serves, so any site could embed it (an <img> or a
  // hidden iframe) to sign a visitor out and wipe their saved provider keys.
  // Sign-out only ever starts from our own pages; a cross-site request just
  // lands on the home page with the session intact. Browsers that send no
  // Sec-Fetch-Site header are unaffected.
  if (pathname === "/auth/logout" && req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(new URL("/", req.url));
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
  // Static-file exemption is top-level only (e.g. /icon.svg). Matching any
  // path ending in .js let /api/dispatches/x.js skip the gate entirely.
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico|[^/]+\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};
