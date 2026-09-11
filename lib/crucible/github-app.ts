// GitHub App credentials stay in memory; serverless deployments have no writable app directory.
import crypto from "node:crypto";
import { githubApi } from "../github-api";

const TOKEN_TTL_MS = 55 * 60 * 1000;
const tokens = new Map<number, { token: string; expiresAt: number }>();
const pending = new Map<number, Promise<string>>();

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
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("Invalid installation ID");
  const json = await githubApi<{ token: string }>(`/app/installations/${installationId}/access_tokens`, appJwt(), {});
  if (typeof json.token !== "string" || !json.token) throw new Error("GitHub returned no installation token");
  return json.token;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokens.get(installationId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const existing = pending.get(installationId);
  if (existing) return existing;
  const request = mintInstallationToken(installationId).then(token => {
    tokens.delete(installationId);
    if (tokens.size >= 100) tokens.delete(tokens.keys().next().value!);
    tokens.set(installationId, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }).finally(() => pending.delete(installationId));
  pending.set(installationId, request);
  return request;
}

function githubUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== "https://api.github.com" || parsed.username || parsed.password) throw new Error("Invalid GitHub API URL");
}

function authenticatedFetch(url: string, token: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  return fetch(url, { ...init, headers, cache: "no-store", redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
}

export async function appFetch(url: string, init: RequestInit = {}): Promise<Response> {
  githubUrl(url);
  return authenticatedFetch(url, appJwt(), init);
}

export async function installationFetch(installationId: number, url: string, init: RequestInit = {}): Promise<Response> {
  githubUrl(url);
  return authenticatedFetch(url, await getInstallationToken(installationId), init);
}
