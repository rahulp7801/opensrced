// The Auth0 client singleton (SDK v4).
//
// v3 had no client object — you imported `getSession` directly and mounted a
// `handleAuth()` catch-all at app/api/auth/[auth0]/route.ts. v4 inverts that:
// you construct one `Auth0Client`, and the MIDDLEWARE mounts the auth routes
// by calling `auth0.middleware(req)`. The catch-all route is gone.
//
// Route changes that come with it — the v3 paths all sat under /api/auth/,
// the v4 ones sit under /auth/:
//   login    → /auth/login
//   logout   → /auth/logout
//   callback → /auth/callback
//   me       → /auth/profile   (also renamed)
// The Auth0 tenant's "Allowed Callback URLs" must be updated to
// <origin>/auth/callback, and "Allowed Logout URLs" to match, or login fails
// with a callback mismatch at the tenant rather than in this code.
//
// Env var renames (v3 → v4):
//   AUTH0_ISSUER_BASE_URL (full URL) → AUTH0_DOMAIN (bare host, no scheme)
//   AUTH0_BASE_URL                   → APP_BASE_URL
// AUTH0_SECRET / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET are unchanged.

import { Auth0Client } from "@auth0/nextjs-auth0/server";

/** Accept the v3 spelling of the two renamed vars so an existing .env.local
 *  keeps working. AUTH0_DOMAIN wants a bare host, but AUTH0_ISSUER_BASE_URL
 *  was a full URL — strip the scheme and any trailing slash rather than
 *  failing with an opaque discovery error. */
function domain(): string | undefined {
  const explicit = process.env.AUTH0_DOMAIN;
  if (explicit) return explicit;
  const legacy = process.env.AUTH0_ISSUER_BASE_URL;
  if (!legacy) return undefined;
  return legacy.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export const auth0 = new Auth0Client({
  domain: domain(),
  appBaseUrl: process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL,
  authorizationParameters: {
    // `connection_scope` asks Auth0 to request these extra scopes from the
    // upstream GitHub OAuth provider, so the token the Auth0 Action embeds
    // in the session can fork repos and open PRs. Only meaningful when the
    // user picks "Continue with GitHub"; email/password logins ignore it.
    //
    // In v3 this lived in handleLogin() inside the catch-all route. With the
    // route gone, it belongs on the client config.
    connection_scope: "public_repo read:user user:email",
  },
});
