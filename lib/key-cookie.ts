import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export type StoredKeys = { anthropic?: string; gemini?: string; maxSpendUsd?: number };
export const KEY_COOKIE_NAME = "opensrcer-keys";
export const KEY_COOKIE_SECONDS = 30 * 24 * 60 * 60;

export function validStoredKeys(value: unknown): value is StoredKeys {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = value as StoredKeys;
  return [keys.anthropic, keys.gemini].every(key => key === undefined || (typeof key === "string" && key.length <= 512 && !/[^\x21-\x7e]/.test(key))) &&
    (keys.maxSpendUsd === undefined || (typeof keys.maxSpendUsd === "number" && Number.isFinite(keys.maxSpendUsd) && keys.maxSpendUsd >= 0.1 && keys.maxSpendUsd <= 10));
}

function encryptionKey(secret: string): Buffer {
  if (!secret) throw new Error("AUTH0_SECRET not set");
  return createHash("sha256").update(secret).digest();
}

export function sealKeys(keys: StoredKeys, owner: string, secret: string): string {
  if (!owner || !validStoredKeys(keys)) throw new Error("Invalid API key settings");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ keys, expires: Date.now() + KEY_COOKIE_SECONDS * 1000 }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openKeys(encoded: string, owner: string, secret: string): StoredKeys {
  try {
    if (!owner || encoded.length > 3000) return {};
    const buffer = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), buffer.subarray(0, 12));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(buffer.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
    return typeof payload.expires === "number" && payload.expires > Date.now() && validStoredKeys(payload.keys) ? payload.keys : {};
  } catch { return {}; }
}
