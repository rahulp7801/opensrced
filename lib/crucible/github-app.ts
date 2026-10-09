// GitHub App credentials stay in memory; serverless deployments have no writable app directory.
import crypto from "node:crypto";
import { githubApi } from "../github-api";

const TOKEN_TTL_MS = 55 * 60 * 1000;
// Keyed by installation, or installation/repository for repo-scoped tokens.
const tokens = new Map<string, { token: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

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

/** Permissions for repository-scoped run tokens. The GitHub App must be
 *  granted at least these (see DEPLOYMENT.md); it should not be granted
 *  `workflows` at all. */
const RUN_TOKEN_PERMISSIONS = { contents: "write", pull_requests: "write", issues: "read", metadata: "read" } as const;

/** `repositories` narrows the token to those repository names in the
 *  installation; omitted, it covers every repository the installation has. */
export async function mintInstallationToken(installationId: number, repositories?: string[]): Promise<string> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("Invalid installation ID");
  if (repositories && (repositories.length === 0 || repositories.some(name => !/^[A-Za-z0-9_.-]{1,100}$/.test(name)))) {
    throw new Error("Invalid repository scope");
  }
  // Repository-scoped tokens go into worker VMs that act on attacker-
  // controllable content. Request only what a run needs: no `workflows`, so
  // an injected patch can never change CI in a connected organization's repo
  // (GitHub refuses such pushes), and nothing beyond this repository.
  const body = repositories ? { repositories, permissions: RUN_TOKEN_PERMISSIONS } : {};
  const json = await githubApi<{ token: string }>(`/app/installations/${installationId}/access_tokens`, appJwt(), body);
  if (typeof json.token !== "string" || !json.token) throw new Error("GitHub returned no installation token");
  return json.token;
}

/** Cached installation token. With `repository`, the token is limited to
 *  that one repository; use that form for anything handed to a child process
 *  or VM that touches repository content. */
export async function getInstallationToken(installationId: number, repository?: string): Promise<string> {
  const key = repository ? `${installationId}/${repository.toLowerCase()}` : String(installationId);
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = mintInstallationToken(installationId, repository ? [repository] : undefined).then(token => {
    // A disconnect can invalidate this mint while the GitHub request is in
    // flight. Only the request still registered for this key may
    // repopulate the cache.
    if (pending.get(key) === request) {
      tokens.delete(key);
      if (tokens.size >= 100) tokens.delete(tokens.keys().next().value!);
      tokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    }
    return token;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

/** Drop every cached token (installation-wide and per-repository). */
export function clearInstallationToken(installationId: number): void {
  const prefix = `${installationId}/`;
  for (const map of [tokens, pending]) {
    for (const key of [...map.keys()]) if (key === String(installationId) || key.startsWith(prefix)) map.delete(key);
  }
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
