// Minimal stale-while-revalidate hook for client-side data fetching.
// Shows cached data instantly, revalidates in the background.
// No external dependencies.

"use client";

import { useEffect, useRef, useState } from "react";

type SWRState<T> = {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  isValidating: boolean;
};

const memCache = new Map<string, { data: unknown; ts: number }>();

export function useSwrFetch<T>(
  url: string | null,
  opts: { refreshInterval?: number; dedupingInterval?: number } = {},
): SWRState<T> {
  const { refreshInterval = 0, dedupingInterval = 5000 } = opts;
  const [state, setState] = useState<SWRState<T>>(() => {
    const hit = url ? memCache.get(url) : null;
    return {
      data: hit ? (hit.data as T) : null,
      error: null,
      isLoading: !hit,
      isValidating: true,
    };
  });
  const lastFetch = useRef(0);

  useEffect(() => {
    if (!url) return;
    let live = true;

    async function revalidate() {
      const now = Date.now();
      if (now - lastFetch.current < dedupingInterval) return;
      lastFetch.current = now;

      setState((s) => ({ ...s, isValidating: true }));
      try {
        const res = await fetch(url!, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (live) {
          memCache.set(url!, { data, ts: now });
          setState({ data, error: null, isLoading: false, isValidating: false });
        }
      } catch (e) {
        if (live) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
            isLoading: false,
            isValidating: false,
          }));
        }
      }
    }

    revalidate();
    const id = refreshInterval > 0 ? setInterval(revalidate, refreshInterval) : undefined;
    return () => {
      live = false;
      if (id) clearInterval(id);
    };
  }, [url, refreshInterval, dedupingInterval]);

  return state;
}
