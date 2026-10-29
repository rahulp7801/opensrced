// "Connect OpenRouter": OpenRouter's own per-user sign-in (OAuth PKCE,
// openrouter.ai/docs/use-cases/oauth-pkce). The user signs in on
// openrouter.ai and approves a key for opensrcer; we exchange the one-time
// code for that key and keep it in the encrypted key cookie (lib/api-keys.ts),
// exactly like a pasted key. Their requests bill their own OpenRouter credits.
//
// OpenRouter accounts are 18+ (openrouter.ai/terms), so the UI asks the user
// to confirm that before sending them there.
//
// The PKCE verifier lives only in a short-lived httpOnly cookie between the
// two requests. It also stops a forged callback: a code issued to someone
// else's challenge cannot be exchanged with this browser's verifier.

import { createHash, randomBytes } from "node:crypto";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
/** Holds the PKCE verifier between /connect and /callback. */
export const PKCE_COOKIE_NAME = "opensrcer-openrouter-pkce";
/** OpenRouter's codes expire after 10 minutes; so does the verifier. */
export const PKCE_COOKIE_SECONDS = 10 * 60;

/** The exchange failed. Its message is safe to show. */
export class OpenRouterAuthError extends Error {}

/** A fresh verifier (43 base64url chars) and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Where to send the user to sign in to OpenRouter and approve a key. */
export function openRouterAuthUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", "opensrcer");
  return url.toString();
}

/** Trade the callback's one-time code for the user's key. */
export async function exchangeOpenRouterCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!/^[\x21-\x7e]{1,512}$/.test(code)) throw new OpenRouterAuthError("OpenRouter sent back an invalid code. Try connecting again.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new OpenRouterAuthError("The sign-in took too long or started in another browser. Try connecting again.");
  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_KEYS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OpenRouterAuthError("Could not reach OpenRouter. Try connecting again.");
  }
  // 403 covers an expired or wrong code (and a verifier mismatch).
  if (!response.ok) throw new OpenRouterAuthError(response.status === 403
    ? "OpenRouter did not accept the sign-in (it may have expired). Try connecting again."
    : `OpenRouter refused the key exchange (${response.status}). Try connecting again.`);
  const body = await response.json().catch(() => null) as { key?: unknown } | null;
  const key = body?.key;
  // Same bounds as a pasted key (lib/key-cookie.ts).
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,512}$/.test(key)) throw new OpenRouterAuthError("OpenRouter returned no usable key. Try connecting again.");
  return key;
}
