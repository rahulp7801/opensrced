// Token resolver. Public flows (no orgCtx) get the existing PAT-or-gh-CLI
// behaviour. Crucible flows that pass { auth0UserId, githubOrg } get a
// cached installation token if (and only if) the user has a verified
// mapping for that org.

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { getInstallationToken } from "./github-app";
import { mappingForOrg } from "./orgs";

export type OrgContext = {
  auth0UserId: string;
  githubOrg: string;
};

export type ResolvedToken = {
  token: string | undefined;
  source: "installation" | "pat" | "gh-cli" | "none";
};

function patOrGhCli(): ResolvedToken {
  if (process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, source: "pat" };
  }
  const gh = process.env.GH_CLI;
  if (!gh || !existsSync(gh)) return { token: undefined, source: "none" };
  try {
    const opts: ExecFileSyncOptions = { encoding: "utf8", timeout: 4000 };
    const out = execFileSync(gh, ["auth", "token"], opts).toString().trim();
    return out ? { token: out, source: "gh-cli" } : { token: undefined, source: "none" };
  } catch {
    return { token: undefined, source: "none" };
  }
}

export async function resolveGithubToken(
  orgCtx?: OrgContext | null,
): Promise<ResolvedToken> {
  if (orgCtx?.auth0UserId && orgCtx.githubOrg) {
    const mapping = mappingForOrg(orgCtx.auth0UserId, orgCtx.githubOrg);
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
