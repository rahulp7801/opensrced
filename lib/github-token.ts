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

import { getSession } from "@auth0/nextjs-auth0";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Namespace claim set by the Auth0 Rule. Must match EXACTLY.
const GITHUB_TOKEN_CLAIM = "https://opensrcer.dev/github_token";

export async function getGitHubTokenFromSession(): Promise<string | null> {
  try {
    const session = await getSession();
    const token = session?.user?.[GITHUB_TOKEN_CLAIM];
    if (typeof token === "string" && token.length > 0) return token;
  } catch {
    // Outside request context (e.g. background dispatcher) — fall through.
  }
  return null;
}

export function getGitHubTokenFromEnv(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = process.env.GH_CLI;
  if (!gh || !existsSync(gh)) return null;
  try {
    const out = execFileSync(gh, ["auth", "token"], {
      encoding: "utf8",
      timeout: 4000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// For use in API route handlers / server components where we have
// request context (getSession works).
export async function resolveGitHubToken(): Promise<string | null> {
  return (await getGitHubTokenFromSession()) ?? getGitHubTokenFromEnv();
}
