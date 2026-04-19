// Encrypted cookie storage for user-provided API keys (Anthropic, Gemini, etc).
// Keys live ONLY in the browser cookie — never on disk, never in a database.
// The cookie is httpOnly (no JS access), encrypted with AUTH0_SECRET via
// AES-256-GCM, and cleared on logout.

import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "opensrcer-keys";
const ALGORITHM = "aes-256-gcm";

function deriveKey(): Buffer {
  const secret = process.env.AUTH0_SECRET;
  if (!secret) throw new Error("AUTH0_SECRET not set");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decrypt(encoded: string): string {
  const key = deriveKey();
  const buf = Buffer.from(encoded, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export type StoredKeys = {
  anthropic?: string;
  gemini?: string;
  maxSpendUsd?: number;
};

export async function getStoredKeys(): Promise<StoredKeys> {
  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) return {};
    return JSON.parse(decrypt(raw)) as StoredKeys;
  } catch {
    return {};
  }
}

export async function setStoredKeys(keys: StoredKeys): Promise<void> {
  const jar = await cookies();
  const encrypted = encrypt(JSON.stringify(keys));
  jar.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
}

export async function clearStoredKeys(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
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
