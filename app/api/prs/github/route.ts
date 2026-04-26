// GET /api/prs/github
// Fetches all open PRs authored by the logged-in user across all repos
// using the GitHub search API via gh CLI. Free — no API key needed.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await resolveGitHubToken();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) env.GH_TOKEN = token;

  try {
    // Get the authenticated user's login
    const { stdout: userJson } = await execFileAsync(
      "gh",
      ["api", "user", "--jq", ".login"],
      { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
    );
    const login = userJson.trim();
    if (!login) {
      return Response.json({ error: "Could not determine GitHub user" }, { status: 401 });
    }

    // Search for all open PRs by this user.
    // gh search prs only supports a subset of fields — use what's available,
    // then enrich with per-PR details for branch/additions/deletions.
    const { stdout } = await execFileAsync(
      "gh",
      [
        "search",
        "prs",
        "--author",
        login,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "repository,title,number,url,state,createdAt,updatedAt,isDraft",
      ],
      { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );

    const raw = JSON.parse(stdout) as Array<{
      repository: { nameWithOwner: string };
      title: string;
      number: number;
      url: string;
      state: string;
      createdAt: string;
      updatedAt: string;
      isDraft: boolean;
    }>;

    // Enrich each PR with branch/additions/deletions via gh pr view
    const prs = await Promise.all(
      raw.map(async (pr) => {
        let branch = "";
        let base = "";
        let additions = 0;
        let deletions = 0;
        let reviewDecision = "";
        let commentCount = 0;
        try {
          const { stdout: detail } = await execFileAsync(
            "gh",
            [
              "pr",
              "view",
              String(pr.number),
              "--repo",
              pr.repository.nameWithOwner,
              "--json",
              "headRefName,baseRefName,additions,deletions,reviewDecision,comments",
            ],
            { env, maxBuffer: 1 * 1024 * 1024, windowsHide: true, timeout: 10000 },
          );
          const d = JSON.parse(detail) as {
            headRefName?: string;
            baseRefName?: string;
            additions?: number;
            deletions?: number;
            reviewDecision?: string;
            comments?: Array<unknown>;
          };
          branch = d.headRefName ?? "";
          base = d.baseRefName ?? "";
          additions = d.additions ?? 0;
          deletions = d.deletions ?? 0;
          reviewDecision = d.reviewDecision ?? "";
          commentCount = Array.isArray(d.comments) ? d.comments.length : 0;
        } catch {
          // If enrichment fails, continue with basic data
        }
        return {
          repo: pr.repository.nameWithOwner,
          title: pr.title,
          number: pr.number,
          url: pr.url,
          state: pr.state,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
          branch,
          base,
          additions,
          deletions,
          reviewDecision,
          isDraft: pr.isDraft,
          commentCount,
        };
      }),
    );

    return Response.json({ login, prs });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
