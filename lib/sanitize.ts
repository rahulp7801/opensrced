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
 * Sanitize a file path from user input. Returns a repo-relative path, or
 * null when the input can't be reduced to one.
 *
 * The previous version did a single pass of `.replace(/\.\.\//g, "")`, which
 * is the classic strip-once bug: `....//` has its inner `../` removed and
 * comes out as `../`. It also left absolute paths (`/etc/passwd`,
 * `C:\Windows\…`) completely untouched, because it only ever looked for
 * traversal segments.
 *
 * This version normalizes first, then rejects anything that still escapes:
 * no leading separator, no drive letter, no `..` segment survives.
 */
export function sanitizeFilePath(input: string): string | null {
  const cleaned = input.replace(/[<>"|?*\x00-\x1F]/g, "").trim().slice(0, 500);
  if (!cleaned) return null;

  // Windows drive-relative (C:foo) and drive-absolute (C:\foo, C:/foo) both
  // escape a directory-relative read, and a UNC path (\\host\share) leaves
  // the machine entirely. Reject on the drive letter alone, not on the
  // separator after it.
  if (/^[A-Za-z]:/.test(cleaned) || /^[\\/]{2}/.test(cleaned)) return null;

  const parts = cleaned.replace(/\\/g, "/").split("/");
  // A leading empty part means the path started with "/" — absolute.
  if (parts[0] === "") return null;

  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    // Reject rather than pop: silently resolving `a/../../b` to `b` turns a
    // traversal attempt into a successful lookup of a different file.
    //
    // Any all-dots segment is rejected, not just "..". Win32 strips trailing
    // dots from a path component, so "...." can collapse to ".." on the way
    // to the filesystem — a segment that looks inert here and traverses
    // there. No legitimate path needs one.
    if (/^\.+$/.test(part)) return null;
    out.push(part);
  }
  return out.length > 0 ? out.join("/") : null;
}

/**
 * Sanitize a GitHub owner or repository name (one path segment).
 * GitHub allows alphanumerics, hyphen, underscore and dot; nothing else can
 * appear in a valid login or repo name, and anything else risks changing the
 * shape of an API URL built from it.
 */
export function sanitizeGitHubName(input: string): string | null {
  const trimmed = input.trim().replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(trimmed)) return null;
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) return null;
  return trimmed;
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
