// Auth0 catch-all: handles /api/auth/login, /api/auth/logout,
// /api/auth/callback, and /api/auth/me.
//
// Custom login config: when the user logs in via the GitHub social
// connection, we request `public_repo` scope so the returned GitHub
// OAuth token can fork repos + create PRs on public repos. The Auth0
// Rule embeds this token in the session as a custom claim.

import { handleAuth, handleLogin } from "@auth0/nextjs-auth0";

export const GET = handleAuth({
  login: handleLogin({
    authorizationParams: {
      // `connection_scope` tells Auth0 to request these additional scopes
      // from the upstream GitHub OAuth provider. Only applies when the
      // user picks "Continue with GitHub". Email/password logins ignore it.
      connection_scope: "public_repo read:user user:email",
    },
  }),
});
