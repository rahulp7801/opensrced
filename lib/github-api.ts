/** GitHub requests use only the caller's token, never a host CLI credential. */
const GITHUB_API_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;

export async function githubResponse(
  path: string,
  token?: string | null,
  body?: unknown,
  accept = "application/vnd.github+json",
  signal?: AbortSignal,
): Promise<Response> {
  if (path.length > 8_000 || !GITHUB_API_PATH.test(path) || path.startsWith("//")) {
    throw new Error("Invalid GitHub API path");
  }
  const url = new URL(path, "https://api.github.com");
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.username || url.password || url.port) {
    throw new Error("Invalid GitHub API destination");
  }
  const response = await fetch(url.href, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opensrcer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Do not forward arbitrary upstream bodies or credentials into user errors.
    const message = response.status === 401 ? "GitHub session expired. Please sign in again."
      : response.status === 403 || response.status === 429 ? "GitHub denied this request or its rate limit was reached. Try again later."
      : response.status === 404 ? "GitHub repository was not found or is not accessible."
      : `GitHub request failed (${response.status}).`;
    throw new Error(message);
  }
  return response;
}

export async function githubApi<T>(path: string, token?: string | null, body?: unknown, signal?: AbortSignal): Promise<T> {
  return (await githubResponse(path, token, body, undefined, signal)).json() as Promise<T>;
}

export async function githubText(path: string, token: string | null, accept: string, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const response = await githubResponse(path, token, undefined, accept, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GitHub returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error("This content is too large to load here. Open it on GitHub.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function githubGraphql<T>(query: string, variables: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<T> {
  const result = await githubApi<{ data?: T; errors?: unknown[] }>("/graphql", token, { query, variables }, signal);
  if (result.errors?.length || !result.data) throw new Error("GitHub could not complete this query. Check repository access and try again.");
  return result.data;
}
