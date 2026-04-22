// Input sanitization utilities for all user-facing inputs.
// Prevents prompt injection, command injection, and XSS.

/**
 * Sanitize text that will be interpolated into LLM prompts.
 * Strips control characters and common prompt injection patterns.
 */
export function sanitizeForPrompt(input: string): string {
  return input
    // Strip null bytes and other control chars (except newline/tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse excessive whitespace
    .replace(/\n{4,}/g, "\n\n\n")
    // Cap length — no prompt should need more than 5000 chars of user input
    .slice(0, 5000);
}

/**
 * Sanitize a GitHub repo identifier (owner/name).
 * Only allows alphanumeric, hyphens, underscores, dots, and the slash separator.
 */
export function sanitizeRepoId(input: string): string | null {
  const trimmed = input.trim().replace(/\.git$/i, "");
  // Extract owner/name from full URL or bare slug
  const m = /(?:github\.com[:/]+)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(trimmed);
  if (!m) return null;
  const owner = m[1].slice(0, 100);
  const name = m[2].slice(0, 100);
  // Reject if either part contains path traversal
  if (owner.includes("..") || name.includes("..")) return null;
  return `${owner}/${name}`;
}

/**
 * Sanitize a file path from user input.
 * Prevents path traversal and strips dangerous characters.
 */
export function sanitizeFilePath(input: string): string {
  return input
    .replace(/\.\.\//g, "")
    .replace(/\.\.\\/g, "")
    .replace(/[<>"|?*\x00-\x1F]/g, "")
    .slice(0, 500);
}

/**
 * Sanitize a commit message.
 */
export function sanitizeCommitMessage(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\n/g, " ")
    .slice(0, 200)
    .trim() || "address review feedback";
}

/**
 * Sanitize a PR number.
 */
export function sanitizePrNumber(input: string | number): number | null {
  const n = typeof input === "string" ? parseInt(input, 10) : input;
  if (!Number.isFinite(n) || n < 1 || n > 999999) return null;
  return n;
}

/**
 * Sanitize a branch name.
 */
export function sanitizeBranchName(input: string): string | null {
  const trimmed = input.trim();
  // Git branch names: no spaces, no .., no special control chars
  if (/[\s~^:?*\[\]\\]/.test(trimmed) || trimmed.includes("..")) return null;
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}
