// Per-route session guard.
//
// middleware.ts gates the whole site, but it must not be the ONLY gate — a
// matcher typo, a new PUBLIC_PATHS entry, or a framework change silently
// exposes every route behind it. Mutating routes call this as their first
// statement so authorization survives a middleware regression.
//
// AUTH_DISABLED=1 is honored here too, so local dev without Auth0 keeps
// working exactly as before.

import { auth0 } from "@/lib/auth0";

/** Null when the caller is authorized; otherwise the 401 to return as-is. */
export async function requireSession(): Promise<Response | null> {
  if (process.env.AUTH_DISABLED === "1") return null;
  try {
    const session = await auth0.getSession();
    if (session?.user) return null;
  } catch {
    // No request context or a malformed session cookie — treat as anonymous.
  }
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
