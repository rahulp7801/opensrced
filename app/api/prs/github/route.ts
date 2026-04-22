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

    // Search for all open PRs by this user
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
        "repository,title,number,url,state,createdAt,updatedAt,headRefName,baseRefName,additions,deletions,reviewDecision,isDraft",
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
      headRefName: string;
      baseRefName: string;
      additions: number;
      deletions: number;
      reviewDecision: string;
      isDraft: boolean;
    }>;

    const prs = raw.map((pr) => ({
      repo: pr.repository.nameWithOwner,
      title: pr.title,
      number: pr.number,
      url: pr.url,
      state: pr.state,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      branch: pr.headRefName,
      base: pr.baseRefName,
      additions: pr.additions,
      deletions: pr.deletions,
      reviewDecision: pr.reviewDecision,
      isDraft: pr.isDraft,
    }));

    return Response.json({ login, prs });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
