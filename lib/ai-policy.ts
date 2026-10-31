// A repository's stance on AI-assisted contributions, read from GitHub before
// a lesson starts and again at publish (always on: a PR the project's own
// policy forbids is wasted work for the contributor and the maintainer).
//
// The files are the contribution guides (root, .github/, docs/) and any
// AI_POLICY / AI.md, fetched from the default branch in one GraphQL call and
// classified by lib/contrib-profile.ts classifyAiPolicy, the same rules the
// run's clone-based profile uses. The matched sentence comes back as evidence
// so a refusal or a disclosure can quote the project's own words.

import { classifyAiPolicy, type AiStance } from "./contrib-profile";
import type { GitHubClient } from "./gh";
import { sanitizeGitHubName } from "./sanitize";

export type AiPolicyStance = "banned" | "disclosure-required" | "allowed" | "unknown";
/** `source` is the file the stance came from; `evidence` its matched sentence. */
export type RepoAiPolicy = { stance: AiPolicyStance; source: string | null; evidence: string | null };

const STANCE: Record<AiStance, AiPolicyStance> = { ban: "banned", disclose: "disclosure-required", welcome: "allowed", unknown: "unknown" };
/** A ban anywhere outranks a disclosure rule, which outranks a welcome. */
const RANK: Record<AiPolicyStance, number> = { unknown: 0, allowed: 1, "disclosure-required": 2, banned: 3 };

/** Where projects put the policy. GraphQL paths are case-sensitive; these are the spellings in use. */
export const AI_POLICY_FILES = ["", ".github/", "docs/"].flatMap((dir) =>
  ["CONTRIBUTING.md", "CONTRIBUTING.rst", "AI_POLICY.md", "AI-POLICY.md", "AI.md", "PULL_REQUEST_TEMPLATE.md", "pull_request_template.md"].map((file) => `${dir}${file}`));

/** How long a repo's policy is reused before it is read again. */
export const AI_POLICY_TTL_MS = 6 * 60 * 60_000;
const MAX_FILE_CHARS = 200_000;

export class InvalidRepoNameError extends Error {
  constructor(repo: string) {
    super(`Not an owner/name repository: ${JSON.stringify(repo.slice(0, 100))}`);
    this.name = "InvalidRepoNameError";
  }
}

/** GitHub could not be read, or the repository is missing. */
export class AiPolicyFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s contribution guide to check its AI policy.`, { cause });
    this.name = "AiPolicyFetchError";
  }
}

/** The strictest stance across the files, with the sentence that set it. Pure. */
export function classifyRepoAiPolicy(files: Array<{ path: string; text: string }>): RepoAiPolicy {
  let policy: RepoAiPolicy = { stance: "unknown", source: null, evidence: null };
  for (const { path, text } of files) {
    const c = classifyAiPolicy(text.slice(0, MAX_FILE_CHARS));
    const stance = STANCE[c.stance];
    if (RANK[stance] > RANK[policy.stance]) policy = { stance, source: path, evidence: c.excerpt };
  }
  return policy;
}

/** "owner/name" split and checked; throws InvalidRepoNameError. */
export function splitRepo(repo: string): [string, string] {
  const [owner, name, extra] = repo.split("/");
  if (extra !== undefined || !owner || !name || !sanitizeGitHubName(owner) || !sanitizeGitHubName(name)) throw new InvalidRepoNameError(repo);
  return [owner, name];
}

/** Read the policy files from GitHub (no cache). Throws AiPolicyFetchError. */
export async function fetchAiPolicy(client: GitHubClient, repo: string): Promise<RepoAiPolicy> {
  const [owner, name] = splitRepo(repo);
  const fields = AI_POLICY_FILES.map((f, i) => `f${i}: object(expression: ${JSON.stringify(`HEAD:${f}`)}) { ... on Blob { text } }`).join("\n");
  let data: { repository: Record<string, { text?: string | null } | null> | null };
  try {
    data = await client.graphql(`query AiPolicy($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, { owner, name });
  } catch (error) {
    throw new AiPolicyFetchError(repo, error);
  }
  if (!data?.repository) throw new AiPolicyFetchError(repo);
  const files = AI_POLICY_FILES.flatMap((path, i) => {
    const text = data.repository?.[`f${i}`]?.text;
    return text ? [{ path, text }] : [];
  });
  return classifyRepoAiPolicy(files);
}

// ponytail: per-instance cache; move to a repos.ai_policy column once the DB is configured everywhere.
const cache = new Map<string, { policy: RepoAiPolicy; expiresAt: number }>();

/** The policy, read at most once per AI_POLICY_TTL_MS per repository. */
export async function repoAiPolicy(client: GitHubClient, repo: string, now = Date.now()): Promise<RepoAiPolicy> {
  const key = splitRepo(repo).join("/").toLowerCase();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.policy;
  const policy = await fetchAiPolicy(client, repo);
  if (cache.size >= 2_000) cache.clear();
  cache.set(key, { policy, expiresAt: now + AI_POLICY_TTL_MS });
  return policy;
}

/** For tests. */
export function clearAiPolicyCache(): void {
  cache.clear();
}

/** The refusal for a banned policy, quoting it; null otherwise. Same wording as contrib-guard's aiBanReason. */
export function aiPolicyBanReason(policy: RepoAiPolicy): string | null {
  if (policy.stance !== "banned") return null;
  return `this project does not accept AI-generated contributions (${policy.source}: "${policy.evidence}")`;
}
