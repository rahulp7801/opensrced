/** GitHub requests use only the caller's token, never a host CLI credential. */
export async function githubApi<T>(
  path: string,
  token?: string | null,
  body?: unknown,
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Invalid GitHub API path");
  }
  const response = await fetch(`https://api.github.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opensrcer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Do not forward arbitrary upstream bodies or credentials into user errors.
    const message = response.status === 401 ? "GitHub session expired. Please sign in again."
      : response.status === 403 || response.status === 429 ? "GitHub denied this request or its rate limit was reached. Try again later."
      : response.status === 404 ? "GitHub repository was not found or is not accessible."
      : `GitHub request failed (${response.status}).`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function githubGraphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const result = await githubApi<{ data?: T; errors?: unknown[] }>("/graphql", token, { query, variables });
  if (result.errors?.length || !result.data) throw new Error("GitHub could not complete this query. Check repository access and try again.");
  return result.data;
}
