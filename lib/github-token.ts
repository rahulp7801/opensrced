// Centralized GitHub token resolution for the entire site.
//
// Priority:
//   1. Session-stored GitHub OAuth token (from Auth0 social login) — this
//      is the logged-in user's own token, scoped to `public_repo` + `read:user`.
//      Available when the user logged in via "Continue with GitHub" and the
//      Auth0 Rule embeds it as a custom claim.
//   2. GITHUB_TOKEN env var (legacy PAT fallback for local dev)
//   3. `gh auth token` via the gh CLI keychain
//
// Crucible flows DON'T use this — they have their own installation-token
// resolver (lib/crucible/tokens.ts). This is for the public-repo flows
// (discover, issues, dispatches, agentic-pr fork+push).

import { auth0 } from "@/lib/auth0";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Namespace claim set by the Auth0 Rule. Must match EXACTLY.
const GITHUB_TOKEN_CLAIM = "https://opensrcer.dev/github_token";

export async function getGitHubTokenFromSession(): Promise<string | null> {
  try {
    // Next.js 15 requires cookies() to be awaited before auth0.getSession().
    // Import dynamically to avoid issues outside request context.
    const { cookies } = await import("next/headers");
    await cookies();
    const session = await auth0.getSession();
    const token = session?.user?.[GITHUB_TOKEN_CLAIM];
    if (typeof token === "string" && token.length > 0) return token;
  } catch {
    // Outside request context (e.g. background dispatcher) — fall through.
  }
  return null;
}

// For use in API route handlers / server components where we have
// request context (getSession works). Falls back to GITHUB_TOKEN env
// var and gh CLI keychain for local dev.
export async function resolveGitHubToken(): Promise<string | null> {
  // 1. Auth0 session
  const sessionToken = await getGitHubTokenFromSession();
  if (sessionToken) return sessionToken;

  // 2. Environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken && envToken.length > 0) return envToken;

  // 3. gh CLI keychain
  try {
    const ghToken = execFileSync("gh", ["auth", "token"], {
      stdio: "pipe",
      timeout: 5000,
      windowsHide: true,
    }).toString().trim();
    if (ghToken.length > 0) return ghToken;
  } catch {
    // gh not installed or not authenticated
  }

  return null;
}
