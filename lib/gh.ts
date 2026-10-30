// GitHub client for NEW code (PLAN.md §4.2 F2): Octokit with throttling,
// retry and REST pagination, created per call with the caller's own token so
// no credential outlives its request. Existing callers keep the raw-fetch
// helpers in github-api.ts; there is no big rewrite.

import { createHash } from "node:crypto";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const GitHub = Octokit.plugin(throttling, retry, paginateRest);
export type GitHubClient = InstanceType<typeof GitHub>;

/** Longest rate-limit wait worth sitting through inside a request. Search's
 *  30/min limit resets within a minute; a primary-limit reset can be an hour
 *  away, and a Vercel Function would time out waiting for it. */
export const MAX_RATE_LIMIT_WAIT_S = 60;

function retryOnce(retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number): boolean {
  return retryCount < 1 && retryAfter <= MAX_RATE_LIMIT_WAIT_S;
}

/** `fetch` is for tests; production uses the global one. */
export function gh(token: string, options: { fetch?: typeof fetch } = {}): GitHubClient {
  if (!token) throw new Error("A GitHub token is required");
  return new GitHub({
    auth: token,
    userAgent: "opensrcer",
    request: options.fetch ? { fetch: options.fetch } : undefined,
    // The limiter's queues live per process; keying them by token makes them
    // per user, like GitHub's own limits, so one user's burst never slows another.
    throttle: { id: createHash("sha256").update(token).digest("hex").slice(0, 16), onRateLimit: retryOnce, onSecondaryRateLimit: retryOnce },
  });
}

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Connection<T> = { nodes: T[]; pageInfo: PageInfo };

/** Follow one GraphQL connection by cursor and return all of its nodes.
 *  The query declares `$cursor: String` and selects
 *  `nodes { ... } pageInfo { hasNextPage endCursor }` on the connection that
 *  `path` names (e.g. ["repository", "issues"]). `maxPages` bounds the cost on
 *  huge repositories; the result is then the first maxPages pages.
 *  ponytail: @octokit/plugin-paginate-graphql does this without a page cap. */
export async function graphqlPaginate<T>(
  client: GitHubClient,
  query: string,
  variables: Record<string, unknown>,
  path: readonly string[],
  maxPages = 10,
): Promise<T[]> {
  if (!path.length) throw new Error("graphqlPaginate needs the connection's path");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("maxPages must be a positive integer");
  const nodes: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: unknown = await client.graphql(query, { ...variables, cursor });
    let connection: unknown = data;
    for (const key of path) connection = (connection as Record<string, unknown> | null)?.[key];
    const { nodes: pageNodes, pageInfo } = (connection ?? {}) as Partial<Connection<T>>;
    if (!Array.isArray(pageNodes) || !pageInfo) throw new Error(`GraphQL response has no connection at ${path.join(".")}`);
    nodes.push(...pageNodes);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }
  return nodes;
}
