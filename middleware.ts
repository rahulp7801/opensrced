// Next.js middleware — gates the ENTIRE site behind Auth0 login.
// Users must log in (via GitHub social connection or email/password)
// before accessing any page or API route. This ensures every GitHub
// operation uses the logged-in user's own token, not the deployer's PAT.
//
// Escape hatch: AUTH_DISABLED=1 skips the check entirely (local dev
// without Auth0 configured).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSession } from "@auth0/nextjs-auth0/edge";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";

// Paths that must remain public regardless of auth state.
const PUBLIC_PATHS = [
  // Landing page — public, explains what opensrcer is.
  "/",
  // Auth0 SDK routes — must be accessible to complete the login flow.
  "/api/auth",
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
  "/runs",
  "/crucible",
  "/demo",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/")),
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip auth for Next.js prefetch requests — these are speculative and
  // should not block on getSession(). The actual page navigation will
  // run the full check.
  if (req.headers.get("next-router-prefetch") === "1" || req.headers.get("purpose") === "prefetch") {
    return NextResponse.next();
  }

  // Logged-in users hitting /login should be redirected to the dashboard.
  if (pathname === "/login" && !AUTH_DISABLED) {
    const res = NextResponse.next();
    const session = await getSession(req, res);
    if (session?.user) {
      return NextResponse.redirect(new URL("/discover", req.url));
    }
    return res;
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (AUTH_DISABLED) {
    const res = NextResponse.next();
    res.headers.set("X-Auth", "disabled-via-env");
    return res;
  }

  const res = NextResponse.next();
  const session = await getSession(req, res);
  if (session?.user) return res;

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
  // This prevents getSession() from running on prefetch/RSC requests
  // that don't need auth gating.
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)"],
};
