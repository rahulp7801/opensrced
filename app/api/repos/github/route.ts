// GET /api/repos/github?tab=contributed|starred|owned&page=1&per_page=15
// Fetches repos from the authenticated user's GitHub account with pagination.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/require-session";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";
import { ghEnv } from "@/lib/child-env";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const DEFAULT_PER_PAGE = 15;

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const tab = req.nextUrl.searchParams.get("tab") ?? "contributed";
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"));
  const perPage = Math.min(30, Math.max(5, parseInt(req.nextUrl.searchParams.get("per_page") ?? String(DEFAULT_PER_PAGE))));

  const token = await resolveGitHubToken();
  // gh acts as the requesting user or as nobody — never as whatever
  // credential the host happens to have on disk. See lib/child-env.ts.
  const env = ghEnv(token);

  type Repo = {
    nameWithOwner: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    updatedAt: string;
    isPrivate: boolean;
    source: string;
  };

  try {
    let repos: Repo[];
    let hasMore = false;

    if (tab === "starred") {
      // GitHub starred API supports pagination natively
      const { stdout } = await execFileAsync(
        "gh",
        [
          "api",
          `user/starred?per_page=${perPage}&page=${page}`,
          "--jq",
          "[.[] | {nameWithOwner: .full_name, description: (.description // \"\"), language: (.language // \"\"), stars: .stargazers_count, forks: .forks_count, updatedAt: .updated_at, isPrivate: .private}]",
        ],
        { env, maxBuffer: 5 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      );
      const parsed = JSON.parse(stdout || "[]") as Repo[];
      repos = parsed.map((r) => ({ ...r, source: "starred" }));
      hasMore = repos.length === perPage;
    } else if (tab === "owned") {
      // gh repo list supports --limit but not offset, so we fetch limit*(page) and slice
      const fetchLimit = perPage * page;
      const { stdout } = await execFileAsync(
        "gh",
        [
          "repo",
          "list",
          "--limit",
          String(fetchLimit + 1), // +1 to detect hasMore
          "--json",
          "nameWithOwner,description,primaryLanguage,stargazerCount,forkCount,updatedAt,isPrivate",
        ],
        { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      );
      const raw = JSON.parse(stdout) as Array<{
        nameWithOwner: string;
        description: string;
        primaryLanguage: { name: string } | null;
        stargazerCount: number;
        forkCount: number;
        updatedAt: string;
        isPrivate: boolean;
      }>;
      const start = (page - 1) * perPage;
      const sliced = raw.slice(start, start + perPage);
      hasMore = raw.length > start + perPage;
      repos = sliced.map((r) => ({
        nameWithOwner: r.nameWithOwner,
        description: r.description ?? "",
        language: r.primaryLanguage?.name ?? "",
        stars: r.stargazerCount,
        forks: r.forkCount,
        updatedAt: r.updatedAt,
        isPrivate: r.isPrivate,
        source: "owned",
      }));
    } else {
      // Contributed to — search PRs, dedupe repos, paginate
      const { stdout: login } = await execFileAsync(
        "gh",
        ["api", "user", "--jq", ".login"],
        { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      );
      const fetchLimit = perPage * page + 10; // fetch extra for dedup
      const { stdout } = await execFileAsync(
        "gh",
        [
          "search",
          "prs",
          "--author",
          login.trim(),
          "--limit",
          String(Math.min(fetchLimit * 3, 200)), // PRs per repo > 1, so overfetch
          "--json",
          "repository",
        ],
        { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      );
      const raw = JSON.parse(stdout) as Array<{ repository: { nameWithOwner: string } }>;

      // Deduplicate
      const seen = new Set<string>();
      const uniqueRepos: string[] = [];
      for (const pr of raw) {
        const name = pr.repository.nameWithOwner;
        if (!seen.has(name)) { seen.add(name); uniqueRepos.push(name); }
      }

      const start = (page - 1) * perPage;
      const pageRepos = uniqueRepos.slice(start, start + perPage);
      hasMore = uniqueRepos.length > start + perPage;

      // Fetch details for this page only
      repos = await Promise.all(
        pageRepos.map(async (name) => {
          try {
            const { stdout: detail } = await execFileAsync(
              "gh",
              ["repo", "view", name, "--json", "nameWithOwner,description,primaryLanguage,stargazerCount,forkCount,updatedAt,isPrivate"],
              { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true, timeout: 10000 },
            );
            const d = JSON.parse(detail) as {
              nameWithOwner: string; description: string;
              primaryLanguage: { name: string } | null;
              stargazerCount: number; forkCount: number;
              updatedAt: string; isPrivate: boolean;
            };
            return {
              nameWithOwner: d.nameWithOwner, description: d.description ?? "",
              language: d.primaryLanguage?.name ?? "", stars: d.stargazerCount,
              forks: d.forkCount, updatedAt: d.updatedAt, isPrivate: d.isPrivate,
              source: "contributed" as const,
            };
          } catch {
            return {
              nameWithOwner: name, description: "", language: "",
              stars: 0, forks: 0, updatedAt: "", isPrivate: false,
              source: "contributed" as const,
            };
          }
        }),
      );
    }

    return Response.json({ repos, page, perPage, hasMore });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
