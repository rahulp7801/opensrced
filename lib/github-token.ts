// Resolve only the requesting user's GitHub credential. The Auth0 save hook
// moves the custom claim into the encrypted session, outside /auth/profile.
// Installation-token flows have their own resolver in lib/crucible/tokens.ts.

import { auth0 } from "@/lib/auth0";
import { githubApi } from "@/lib/github-api";

// lib/auth-session.ts preserves the custom claim outside the public user profile.

export async function getGitHubTokenFromSession(): Promise<string | null> {
  try {
    // Next.js 15 requires cookies() to be awaited before auth0.getSession().
    // Import dynamically to avoid issues outside request context.
    const { cookies } = await import("next/headers");
    await cookies();
    const session = await auth0.getSession();
    const token = session?.githubToken;
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
  if (process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production" && process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  return null;
}

export type CommitAuthor = { login: string; id: number };

/** The requesting user's own GitHub identity. Commits are attributed to them
 *  even when an installation token pushes (installation tokens cannot read
 *  /user). Null when there is no user token. */
export async function resolveCommitAuthor(signal?: AbortSignal): Promise<CommitAuthor | null> {
  const token = await resolveGitHubToken();
  if (!token) return null;
  const user = await githubApi<{ login: string; id: number }>("/user", token, undefined, signal);
  return { login: user.login, id: user.id };
}
