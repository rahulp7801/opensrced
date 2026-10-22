import { sanitizeGitHubName, validGitHubOwner } from "./sanitize";

/** Accept only GitHub repository and issue URLs (or owner/repo). */
export function parseRunTarget(input: unknown): { repo: string; issue?: number } {
  if (typeof input !== "string") throw new Error("Enter a GitHub repository or issue URL.");
  // The github.com prefix may come in any casing, with http or www.
  const match = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s?#]+?)(?:\/issues\/([1-9]\d*))?\/?(?:[?#].*)?$/i.exec(input.trim());
  const owner = match && validGitHubOwner(match[1]) ? match[1] : null;
  const name = match && sanitizeGitHubName(match[2]);
  const issue = match?.[3] ? Number(match[3]) : undefined;
  if (!owner || !name || (issue !== undefined && !Number.isSafeInteger(issue))) {
    throw new Error("Enter a valid GitHub repository or issue URL.");
  }
  return { repo: `${owner}/${name}`, ...(issue === undefined ? {} : { issue }) };
}
