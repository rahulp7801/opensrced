const LOCAL_ORIGIN = "https://opensrcer.invalid";

/** Canonicalize an authentication return target to this application. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/")) return "/";
  try {
    decodeURI(value);
    const target = new URL(value, LOCAL_ORIGIN);
    if (target.origin !== LOCAL_ORIGIN) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
