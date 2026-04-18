// Mints GitHub App JWTs and exchanges them for installation tokens.
// Tokens live 60 min; we cache with a 55-min TTL both in-process and on
// disk at .dispatches/crucible-tokens-cache.json so a dev-server restart
// doesn't stampede GitHub for fresh tokens.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CACHE_PATH = path.join(process.cwd(), ".dispatches", "crucible-tokens-cache.json");
const TOKEN_TTL_MS = 55 * 60 * 1000;

type CacheEntry = { token: string; expiresAt: number };
type Cache = Record<string, CacheEntry>;

let memCache: Cache | null = null;

function loadCache(): Cache {
  if (memCache) return memCache;
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    memCache = JSON.parse(raw) as Cache;
  } catch {
    memCache = {};
  }
  return memCache!;
}

function saveCache(cache: Cache) {
  memCache = cache;
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function getPrivateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY not set");
  // Support both literal-newline PEM and \n-escaped single-line form.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID not set");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  // 60s clock-skew buffer on iat, 9-min lifetime (GitHub max is 10).
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };

  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer
    .sign(getPrivateKey())
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signature}`;
}

export async function mintInstallationToken(installationId: number): Promise<string> {
  const jwt = appJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`mintInstallationToken failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { token: string };
  return json.token;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const cache = loadCache();
  const key = String(installationId);
  const entry = cache[key];
  if (entry && entry.expiresAt > Date.now()) return entry.token;

  const token = await mintInstallationToken(installationId);
  cache[key] = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  saveCache(cache);
  return token;
}

// Small fetch wrapper that signs with the App JWT (not an installation
// token). Used by the install-callback flow to call /orgs/:org/memberships
// and to fetch installation metadata before we've picked an installation.
export async function appFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const jwt = appJwt();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

// Installation-token fetch wrapper. Used everywhere we act on behalf of
// an org (advisories, repo listing, etc.).
export async function installationFetch(
  installationId: number,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getInstallationToken(installationId);
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}
