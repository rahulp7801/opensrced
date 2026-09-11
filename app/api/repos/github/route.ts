import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { githubApi, githubGraphql } from "@/lib/github-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Repo = { nameWithOwner: string; description: string | null; primaryLanguage: { name: string } | null;
  stargazerCount: number; forkCount: number; updatedAt: string; isPrivate: boolean };

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  const token = await resolveGitHubToken();
  if (!token) return Response.json({ error: "Sign in with GitHub to view your repositories." }, { status: 401 });
  const tab = req.nextUrl.searchParams.get("tab") ?? "contributed";
  const page = Number(req.nextUrl.searchParams.get("page") ?? 1);
  const cursor = req.nextUrl.searchParams.get("cursor");
  const perPage = Number(req.nextUrl.searchParams.get("per_page") ?? 15);
  if (!["contributed", "starred", "owned"].includes(tab) || !Number.isInteger(page) || page < 1 || page > 1000 || (cursor !== null && cursor.length > 512) || (tab === "contributed" && page > 1 && !cursor) ||
      !Number.isInteger(perPage) || perPage < 5 || perPage > 30) {
    return Response.json({ error: "Invalid repository tab or pagination." }, { status: 400 });
  }
  try {
    let raw: Repo[];
    let hasMore: boolean;
    let nextCursor: string | null = null;
    if (tab === "contributed") {
      type Result = { viewer: { repositoriesContributedTo: { nodes: Repo[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } };
      const result = await githubGraphql<Result>(`query Repos($first: Int!, $after: String) {
        viewer { repositoriesContributedTo(first: $first, after: $after, contributionTypes: [PULL_REQUEST], includeUserRepositories: true, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { nameWithOwner description primaryLanguage { name } stargazerCount forkCount updatedAt isPrivate }
          pageInfo { hasNextPage endCursor }
        } }
      }`, { first: perPage, after: page === 1 ? null : cursor }, token, req.signal);
      const connection = result.viewer.repositoriesContributedTo;
      raw = connection.nodes;
      hasMore = connection.pageInfo.hasNextPage && !!connection.pageInfo.endCursor;
      nextCursor = hasMore ? connection.pageInfo.endCursor : null;
    } else {
      type RestRepo = { full_name: string; description: string | null; language: string | null;
        stargazers_count: number; forks_count: number; updated_at: string; private: boolean };
      const endpoint = tab === "starred" ? "/user/starred" : "/user/repos";
      const params = new URLSearchParams({ per_page: String(perPage), page: String(page), sort: "updated", direction: "desc" });
      if (tab === "owned") params.set("affiliation", "owner");
      const items = await githubApi<RestRepo[]>(`${endpoint}?${params}`, token, undefined, req.signal);
      hasMore = items.length === perPage;
      raw = items.map((item) => ({ nameWithOwner: item.full_name, description: item.description,
        primaryLanguage: item.language ? { name: item.language } : null, stargazerCount: item.stargazers_count,
        forkCount: item.forks_count, updatedAt: item.updated_at, isPrivate: item.private }));
    }
    const repos = raw.map((repo) => ({ nameWithOwner: repo.nameWithOwner, description: repo.description ?? "",
      language: repo.primaryLanguage?.name ?? "", stars: repo.stargazerCount, forks: repo.forkCount,
      updatedAt: repo.updatedAt, isPrivate: repo.isPrivate, source: tab }));
    return Response.json({ repos, page, per_page: perPage, hasMore, nextCursor, tab });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "GitHub request failed." }, { status: 502 });
  }
}
