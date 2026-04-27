// Tiny in-memory cache for client-side fetches. Survives back/forward
// navigation within the SPA session because the module stays loaded;
// hard reload (F5) clears it. Each tab has its own cache.
//
// Use case: panels that fetch on mount (SuggestedIssues, IssueScanner,
// etc.). Without this, every back/forward navigation triggers a fresh
// network round-trip even if the user just left the page seconds ago.

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type Entry<T> = { value: T; fetchedAt: number };

const stores = new Map<string, Map<string, Entry<unknown>>>();

function getStore(namespace: string): Map<string, Entry<unknown>> {
  let s = stores.get(namespace);
  if (!s) {
    s = new Map();
    stores.set(namespace, s);
  }
  return s;
}

export function cacheGet<T>(
  namespace: string,
  key: string,
  ttlMs = DEFAULT_TTL_MS,
): T | null {
  const e = getStore(namespace).get(key) as Entry<T> | undefined;
  if (!e) return null;
  if (Date.now() - e.fetchedAt > ttlMs) {
    getStore(namespace).delete(key);
    return null;
  }
  return e.value;
}

export function cacheSet<T>(namespace: string, key: string, value: T): void {
  getStore(namespace).set(key, { value, fetchedAt: Date.now() });
}

export function cacheClear(namespace: string, key?: string): void {
  if (key) {
    getStore(namespace).delete(key);
  } else {
    stores.delete(namespace);
  }
}
