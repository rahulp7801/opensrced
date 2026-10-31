const LOCAL_ORIGIN = "https://opensrcer.invalid";

/** Canonicalize an authentication return target to this application. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/")) return "/";
  try {
    decodeURI(value);
    const target = new URL(value, LOCAL_ORIGIN);
    // "/.//evil.example" normalizes to "//evil.example", a protocol-relative URL.
    if (target.origin !== LOCAL_ORIGIN || target.pathname.startsWith("//")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

/** Straight to GitHub (connection=github skips Auth0's own provider screen;
 *  middleware allows exactly that value), then back to `returnTo`. */
export function signInHref(returnTo: string | undefined): string {
  return `/auth/login?connection=github&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
