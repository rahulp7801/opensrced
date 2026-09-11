"use client";

import { useEffect, useState } from "react";
import { pollJson } from "./poll-json";

type SWRState<T> = {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  isValidating: boolean;
};

const memCache = new Map<string, unknown>();

function initialState<T>(url: string | null): SWRState<T> {
  const data = url ? (memCache.get(url) as T | undefined) ?? null : null;
  return { data, error: null, isLoading: !!url && data === null, isValidating: !!url };
}

export function useSwrFetch<T>(
  url: string | null,
  opts: { refreshInterval?: number; dedupingInterval?: number } = {},
): SWRState<T> {
  const { refreshInterval = 0, dedupingInterval = 5000 } = opts;
  const [state, setState] = useState(() => ({ url, ...initialState<T>(url) }));

  useEffect(() => {
    setState({ url, ...initialState<T>(url) });
    if (!url) return;
    return pollJson<T>(url, (result) => {
      if (result.error !== null) {
        setState((s) => ({ ...s, error: result.error, isLoading: false, isValidating: false }));
      } else {
        // Bound memory across URL changes in a long-lived tab.
        memCache.delete(url);
        memCache.set(url, result.data);
        if (memCache.size > 100) memCache.delete(memCache.keys().next().value!);
        setState({ url, data: result.data, error: null, isLoading: false, isValidating: false });
      }
    }, refreshInterval > 0 ? Math.max(refreshInterval, dedupingInterval) : 0);
  }, [url, refreshInterval, dedupingInterval]);

  // Never show another URL's result while waiting for its effect to run.
  return state.url === url ? state : initialState<T>(url);
}
