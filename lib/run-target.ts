import { sanitizeGitHubName } from "./sanitize";

/** Accept only GitHub repository and issue URLs (or owner/repo). */
export function parseRunTarget(input: unknown): { repo: string; issue?: number } {
  if (typeof input !== "string") throw new Error("Enter a GitHub repository or issue URL.");
  const match = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s?#]+?)(?:\/issues\/([1-9]\d*))?\/?(?:[?#].*)?$/.exec(input.trim());
  const owner = match && sanitizeGitHubName(match[1]);
  const name = match && sanitizeGitHubName(match[2]);
  const issue = match?.[3] ? Number(match[3]) : undefined;
  if (!owner || !name || (issue !== undefined && !Number.isSafeInteger(issue))) {
    throw new Error("Enter a valid GitHub repository or issue URL.");
  }
  return { repo: `${owner}/${name}`, ...(issue === undefined ? {} : { issue }) };
}
