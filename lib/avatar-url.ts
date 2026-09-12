export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com" && !url.username && !url.password && !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}
