// GET /api/prs/review?repo=owner/name&pr=123
// Fetches review comments for a PR using the gh CLI.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitHubToken } from "@/lib/github-token";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo");
  const pr = req.nextUrl.searchParams.get("pr");

  if (!repo || !pr) {
    return Response.json(
      { error: "Missing repo or pr query param" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) env.GH_TOKEN = token;

  try {
    // Fetch PR metadata
    const { stdout: prJson } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        pr,
        "--repo",
        repo,
        "--json",
        "title,state,url,body,headRefName,baseRefName,author",
      ],
      { env, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
    );
    const prData = JSON.parse(prJson) as {
      title: string;
      state: string;
      url: string;
      body: string;
      headRefName: string;
      baseRefName: string;
      author: { login: string };
    };

    // Fetch inline review comments (code-level feedback)
    const { stdout: commentsJson } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${repo}/pulls/${pr}/comments`,
        "--paginate",
      ],
      { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );
    const rawComments = JSON.parse(commentsJson) as Array<{
      id: number;
      user: { login: string };
      body: string;
      path: string;
      line: number | null;
      original_line: number | null;
      diff_hunk: string;
      created_at: string;
      in_reply_to_id?: number;
    }>;

    // Also fetch general issue comments (non-inline)
    const { stdout: issueCommentsJson } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${repo}/issues/${pr}/comments`,
        "--paginate",
      ],
      { env, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );
    const rawIssueComments = JSON.parse(issueCommentsJson) as Array<{
      id: number;
      user: { login: string };
      body: string;
      created_at: string;
    }>;

    // Filter out bots — match both exact names and [bot] suffix
    function isBot(login: string): boolean {
      if (login.endsWith("[bot]")) return true;
      const botNames = new Set([
        "azure-pipelines", "github-actions", "dependabot",
        "copilot-pull-request-reviewer", "coderabbitai", "codecov",
        "netlify", "vercel", "renovate", "sonarcloud",
      ]);
      return botNames.has(login.replace(/\[bot\]$/, ""));
    }

    const reviewComments = rawComments
      .filter((c) => !isBot(c.user.login))
      .map((c) => ({
        id: c.id,
        author: c.user.login,
        body: c.body,
        path: c.path,
        line: c.line ?? c.original_line,
        diffHunk: c.diff_hunk,
        createdAt: c.created_at,
        type: "review" as const,
        inReplyTo: c.in_reply_to_id ?? null,
      }));

    // Show all non-bot issue comments (including from maintainers
    // AND other contributors). Only filter out your own replies.
    const issueComments = rawIssueComments
      .filter((c) => !isBot(c.user.login))
      .map((c) => ({
        id: c.id,
        author: c.user.login,
        body: c.body,
        path: null as string | null,
        line: null as number | null,
        diffHunk: null as string | null,
        createdAt: c.created_at,
        type: "issue" as const,
        inReplyTo: null as number | null,
        isOwnComment: c.user.login === prData.author.login,
      }));

    return Response.json({
      pr: {
        title: prData.title,
        state: prData.state,
        url: prData.url,
        branch: prData.headRefName,
        base: prData.baseRefName,
        author: prData.author.login,
      },
      comments: [...reviewComments, ...issueComments].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() -
          new Date(b.createdAt).getTime(),
      ),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
