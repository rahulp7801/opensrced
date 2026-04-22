// GET /api/repos/github?tab=contributed|starred|owned
// Fetches repos from the authenticated user's GitHub account.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get("tab") ?? "contributed";
  const token = await resolveGitHubToken();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) env.GH_TOKEN = token;

  try {
    let repos: Array<{
      nameWithOwner: string;
      description: string;
      language: string;
      stars: number;
      forks: number;
      updatedAt: string;
      isPrivate: boolean;
      source: string;
    }>;

    if (tab === "starred") {
      // Starred repos
      const { stdout } = await execFileAsync(
        "gh",
        [
          "api",
          "user/starred",
          "--paginate",
          "--jq",
          "[.[] | {nameWithOwner: .full_name, description: (.description // \"\"), language: (.language // \"\"), stars: .stargazers_count, forks: .forks_count, updatedAt: .updated_at, isPrivate: .private}]",
        ],
        { env, maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 20000 },
      );
      // gh --paginate with --jq returns multiple JSON arrays, one per page
      const arrays = stdout.trim().split("\n").filter(Boolean);
      const all = arrays.flatMap((a) => {
        try { return JSON.parse(a); } catch { return []; }
      });
      repos = all.slice(0, 50).map((r: Record<string, unknown>) => ({
        ...r,
        source: "starred",
      })) as typeof repos;
    } else if (tab === "owned") {
      // User's own repos
      const { stdout } = await execFileAsync(
        "gh",
        [
          "repo",
          "list",
          "--limit",
          "50",
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
      repos = raw.map((r) => ({
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
      // Contributed to — repos where user has PRs (merged or open)
      const { stdout: login } = await execFileAsync(
        "gh",
        ["api", "user", "--jq", ".login"],
        { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      );
      const { stdout } = await execFileAsync(
        "gh",
        [
          "search",
          "prs",
          "--author",
          login.trim(),
          "--limit",
          "100",
          "--json",
          "repository",
        ],
        { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      );
      const raw = JSON.parse(stdout) as Array<{
        repository: { nameWithOwner: string };
      }>;

      // Deduplicate repos
      const seen = new Set<string>();
      const uniqueRepos: string[] = [];
      for (const pr of raw) {
        const name = pr.repository.nameWithOwner;
        if (!seen.has(name)) {
          seen.add(name);
          uniqueRepos.push(name);
        }
      }

      // Fetch details for each unique repo (parallel, capped at 20)
      repos = await Promise.all(
        uniqueRepos.slice(0, 20).map(async (name) => {
          try {
            const { stdout: detail } = await execFileAsync(
              "gh",
              [
                "repo",
                "view",
                name,
                "--json",
                "nameWithOwner,description,primaryLanguage,stargazerCount,forkCount,updatedAt,isPrivate",
              ],
              { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true, timeout: 10000 },
            );
            const d = JSON.parse(detail) as {
              nameWithOwner: string;
              description: string;
              primaryLanguage: { name: string } | null;
              stargazerCount: number;
              forkCount: number;
              updatedAt: string;
              isPrivate: boolean;
            };
            return {
              nameWithOwner: d.nameWithOwner,
              description: d.description ?? "",
              language: d.primaryLanguage?.name ?? "",
              stars: d.stargazerCount,
              forks: d.forkCount,
              updatedAt: d.updatedAt,
              isPrivate: d.isPrivate,
              source: "contributed" as const,
            };
          } catch {
            return {
              nameWithOwner: name,
              description: "",
              language: "",
              stars: 0,
              forks: 0,
              updatedAt: "",
              isPrivate: false,
              source: "contributed" as const,
            };
          }
        }),
      );
    }

    return Response.json({ repos });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
