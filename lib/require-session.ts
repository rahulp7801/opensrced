// Per-route session guard.
//
// middleware.ts gates the whole site, but it must not be the ONLY gate — a
// matcher typo, a new PUBLIC_PATHS entry, or a framework change silently
// exposes every route behind it. Mutating routes call this as their first
// statement so authorization survives a middleware regression.
//
// AUTH_DISABLED=1 is honored here too, so local dev without Auth0 keeps
// working exactly as before — but only outside production. Middleware returns
// a deterministic 503 if that flag reaches production, before any route runs.

import { auth0 } from "@/lib/auth0";

/** True only when auth is disabled AND we're not in production. */
export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
}

/** True for the unsafe production configuration middleware must reject. */
export function unsafeAuthConfig(): boolean {
  return process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV === "production";
}

/** Null when the caller is authorized; otherwise the 401 to return as-is. */
export async function requireSession(): Promise<Response | null> {
  if (authDisabled()) return null;
  try {
    const session = await auth0.getSession();
    if (session?.user) return null;
  } catch {
    // No request context or a malformed session cookie — treat as anonymous.
  }
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}

/** The caller's stable identity, or null when anonymous.
 *
 *  Routes that own per-user resources (dispatches, org mappings) need the
 *  subject, not just "is someone logged in". With AUTH_DISABLED the whole
 *  instance is one implicit local user, so everything is attributed to a
 *  fixed sentinel rather than to nobody — otherwise ownership filters would
 *  hide every record from the only user there is. */
export async function sessionUserId(): Promise<string | null> {
  if (authDisabled()) return "local-dev";
  try {
    const session = await auth0.getSession();
    return session?.user?.sub ?? null;
  } catch {
    return null;
  }
}
