// Encrypted cookie storage for user-provided API keys (Anthropic, Gemini, etc).
// Keys live ONLY in the browser cookie — never on disk, never in a database.
// The cookie is httpOnly (no JS access), encrypted with AUTH0_SECRET via
// AES-256-GCM, bound to the account, and cleared on logout.

import { cookies } from "next/headers";
import { sessionUserId } from "./require-session";
import { KEY_COOKIE_NAME, KEY_COOKIE_SECONDS, sealKeys, openKeys, type StoredKeys } from "./key-cookie";
export type { StoredKeys } from "./key-cookie";

export async function getStoredKeys(): Promise<StoredKeys> {
  try {
    const jar = await cookies();
    const raw = jar.get(KEY_COOKIE_NAME)?.value;
    if (!raw) return {};
    const owner = await sessionUserId();
    return owner ? openKeys(raw, owner, process.env.AUTH0_SECRET ?? "") : {};
  } catch {
    return {};
  }
}

export async function setStoredKeys(keys: StoredKeys): Promise<void> {
  const jar = await cookies();
  const owner = await sessionUserId();
  if (!owner) throw new Error("Not authenticated");
  const encrypted = sealKeys(keys, owner, process.env.AUTH0_SECRET ?? "");
  jar.set(KEY_COOKIE_NAME, encrypted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: KEY_COOKIE_SECONDS,
  });
}

export async function clearStoredKeys(): Promise<void> {
  const jar = await cookies();
  jar.delete(KEY_COOKIE_NAME);
}

// Resolve API keys from the user's encrypted cookie ONLY.
// No env fallback — keys must be explicitly set by the user.
export async function resolveAnthropicKey(): Promise<string | null> {
  const keys = await getStoredKeys();
  return keys.anthropic || null;
}

export async function resolveGeminiKey(): Promise<string | null> {
  const keys = await getStoredKeys();
  return keys.gemini || null;
}

export async function resolveMaxSpendUsd(): Promise<number> {
  const keys = await getStoredKeys();
  return keys.maxSpendUsd ?? 2;
}
