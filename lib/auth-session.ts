import { filterDefaultIdTokenClaims } from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";

export const GITHUB_TOKEN_CLAIM = "https://opensrcer.dev/github_token";

/** Keep provider credentials in the encrypted server session, never /auth/profile. */
export async function prepareSession(session: SessionData): Promise<SessionData> {
  const candidate = session.user[GITHUB_TOKEN_CLAIM] ?? session.githubToken;
  const githubToken = typeof candidate === "string" && candidate.length > 0 && candidate.length <= 1024 && !/\s/.test(candidate) ? candidate : undefined;
  return { ...session, githubToken, user: filterDefaultIdTokenClaims(session.user) };
}
