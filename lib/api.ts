// Centralized fetch layer. When CONTRIBAI_API_URL is set, the dashboard's
// /api/* routes proxy to the real Rust web-server; otherwise they serve seed data.

export const UPSTREAM = process.env.CONTRIBAI_API_URL?.replace(/\/$/, "") || null;
export const UPSTREAM_KEY = process.env.CONTRIBAI_API_KEY || null;

export function hasUpstream(): boolean {
  return UPSTREAM !== null;
}

export async function proxy<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!UPSTREAM) return null;
  const headers = new Headers(init?.headers);
  if (UPSTREAM_KEY) headers.set("X-API-Key", UPSTREAM_KEY);
  headers.set("Accept", "application/json");
  try {
    const res = await fetch(`${UPSTREAM}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Server-side fetch of our own /api routes (called from RSC).
export async function internal<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000";
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Internal fetch failed: ${path}`);
  return (await res.json()) as T;
}
