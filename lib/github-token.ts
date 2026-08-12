// Centralized GitHub token resolution for the entire site.
//
// There is exactly one source: the GitHub OAuth token the Auth0 Action
// embeds in the logged-in user's session as a custom claim. Every GitHub
// write this app performs is attributable to the human who asked for it.
//
// The GITHUB_TOKEN env var and `gh auth token` keychain fallbacks are gone.
// They read as harmless local-dev conveniences, but in a deployed multi-user
// instance they were a privilege escalation: a user whose session carried no
// GitHub claim silently borrowed the DEPLOYER's credential, so e.g.
// POST /api/prs/push — which takes an arbitrary repo, branch and diff —
// could write to any repository the deployer could write to.
//
// Local dev without Auth0 still works: AUTH_DISABLED=1 plus an explicit
// GITHUB_TOKEN is honored below, but only when auth is disabled outright,
// which is already refused in production (see lib/require-session.ts).
//
// Crucible flows DON'T use this — they have their own installation-token
// resolver (lib/crucible/tokens.ts). This is for the public-repo flows
// (discover, issues, dispatches, agentic-pr fork+push).

import { auth0 } from "@/lib/auth0";

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

/** The requesting user's GitHub token, or null. Never the deployer's. */
export async function resolveGitHubToken(): Promise<string | null> {
  const sessionToken = await getGitHubTokenFromSession();
  if (sessionToken) return sessionToken;

  // Local dev escape hatch, and ONLY that: auth is off entirely, so there is
  // no user identity to attribute anything to and no other user to leak
  // across to. Production refuses to boot with AUTH_DISABLED set.
  if (process.env.AUTH_DISABLED === "1" && process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  return null;
}
