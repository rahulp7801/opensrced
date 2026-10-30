// One answer to "an API said 401". The client fetch helpers (fetch-json,
// poll-json, use-swr-fetch) already turn a 401 into a message, but many
// components call fetch directly and either show their own text or nothing.
// So the check sits under all of them: components/session-expired-prompt.tsx
// wraps the page's fetch once with watchUnauthorized(), and any same-origin
// /api/ request that comes back 401 raises one consistent sign-in prompt.

/** True for a 401 from this app's own API. Third-party and non-API answers
 *  (the Auth0 profile route says 204 when signed out) never count. */
export function isExpiredSession(input: RequestInfo | URL, status: number, origin: string): boolean {
  if (status !== 401) return false;
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const url = new URL(raw, origin);
    return url.origin === origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** `fetchImpl`, calling `onExpired` after any response isExpiredSession()
 *  accepts. The response itself is passed through untouched. */
export function watchUnauthorized(fetchImpl: typeof fetch, origin: string, onExpired: () => void): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (isExpiredSession(input, response.status, origin)) onExpired();
    return response;
  };
}
