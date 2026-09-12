// Token resolver. Public flows (no orgCtx) get the existing PAT-or-gh-CLI
// behaviour. Crucible flows that pass { auth0UserId, githubOrg } get a
// cached installation token if (and only if) the user has a verified
// mapping for that org.

import { getInstallationToken } from "./github-app";
import { mappingForOrg } from "./orgs";
import { resolveGitHubToken } from "../github-token";
import { parseRunTarget } from "../run-target";
import { githubApi } from "../github-api";

export type OrgContext = {
  auth0UserId: string;
  githubOrg: string;
};

export type ResolvedToken = {
  token: string | undefined;
  source: "installation" | "oauth" | "pat" | "gh-cli" | "none";
};

// No env/CLI fallback — tokens must come from the authenticated user's
// session or from an installation token for connected orgs.
function patOrGhCli(): ResolvedToken {
  return { token: undefined, source: "none" };
}

export async function resolveGithubToken(
  orgCtx?: OrgContext | null,
): Promise<ResolvedToken> {
  if (orgCtx?.auth0UserId && orgCtx.githubOrg) {
    const mapping = await mappingForOrg(orgCtx.auth0UserId, orgCtx.githubOrg);
    if (mapping) {
      const token = await getInstallationToken(mapping.installation_id);
      return { token, source: "installation" };
    }
    // Org context supplied but no verified mapping — do NOT fall back to
    // a PAT; that would silently leak public-scope tokens into a path the
    // caller expected to be installation-scoped.
    return { token: undefined, source: "none" };
  }
  return patOrGhCli();
}

/** Resolve access for a repository selected from the combined public and
 * connected-organization picker. Verified GitHub App access takes priority
 * for a connected owner; other repositories use the caller's OAuth token. */
export async function resolveRepositoryToken(
  auth0UserId: string,
  repo: string,
): Promise<ResolvedToken> {
  const canonical = parseRunTarget(repo).repo;
  const owner = canonical.split("/")[0];
  try {
    const installation = await resolveGithubToken({ auth0UserId, githubOrg: owner });
    if (installation.token) {
      await githubApi(`/repos/${canonical}`, installation.token);
      return installation;
    }
  } catch {
    // A GitHub App may be installed for only selected repositories. Fall
    // through to this user's OAuth access for public or separately granted
    // repositories under the same owner.
  }
  const token = await resolveGitHubToken();
  await githubApi(`/repos/${canonical}`, token);
  return { token: token ?? undefined, source: token ? "oauth" : "none" };
}
