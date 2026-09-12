import { sanitizeGitHubName, sanitizePrNumber } from "./sanitize";

export type GitHubPullUrl = { url: string; repoFull: string; prNumber: number };

/** Accept only canonical, credential-free github.com pull-request URLs. */
export function parseGitHubPullUrl(value: string): GitHubPullUrl | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[2] !== "pull") return null;
    const owner = sanitizeGitHubName(parts[0]);
    const repo = sanitizeGitHubName(parts[1]);
    const prNumber = sanitizePrNumber(parts[3]);
    if (!owner || !repo || !prNumber) return null;
    const repoFull = `${owner}/${repo}`;
    return { url: `https://github.com/${repoFull}/pull/${prNumber}`, repoFull, prNumber };
  } catch {
    return null;
  }
}

/** Find a validated pull-request URL in untrusted command or model output. */
export function findGitHubPullUrl(text: string): GitHubPullUrl | null {
  const prefix = "https://github.com/";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(prefix, cursor);
    if (start < 0) return null;
    let end = start + prefix.length;
    while (end < text.length && text.charCodeAt(end) > 32 && !"<>\"'".includes(text[end])) end++;
    const parsed = parseGitHubPullUrl(text.slice(start, end));
    if (parsed) return parsed;
    cursor = start + prefix.length;
  }
  return null;
}
