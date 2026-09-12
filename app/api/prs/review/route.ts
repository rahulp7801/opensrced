// GET /api/prs/review?repo=owner/name&pr=123
// Fetches review comments for a PR using the GitHub API.

import { NextRequest } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizePrNumber } from "@/lib/sanitize";
import { requireSession } from "@/lib/require-session";


import { githubApi } from "@/lib/github-api";

export const maxDuration = 180;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const rawRepo = req.nextUrl.searchParams.get("repo");
  const rawPr = req.nextUrl.searchParams.get("pr");

  if (!rawRepo || !rawPr) {
    return Response.json(
      { error: "Missing repo or pr query param" },
      { status: 400 },
    );
  }

  const repo = sanitizeRepoId(rawRepo);
  const pr = sanitizePrNumber(rawPr);

  if (!repo || !pr) {
    return Response.json(
      { error: "Invalid repo or pr param" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  try {
    type Comment = { id: number; user: { login: string }; body: string; path: string; line: number | null; original_line: number | null; diff_hunk: string; created_at: string; in_reply_to_id?: number };
    async function comments(path: string): Promise<Comment[]> {
      const all: Comment[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await githubApi<Comment[]>(`${path}?per_page=100&page=${page}`, token);
        all.push(...batch);
        if (batch.length < 100) return all;
      }
      throw new Error("This PR has too many comments to load here. Open the conversation on GitHub.");
    }
    const [pull, rawComments, rawIssueComments, viewer] = await Promise.all([
      githubApi<{ title: string; state: string; merged: boolean; html_url: string; head: { ref: string; repo: { full_name: string } | null }; base: { ref: string }; user: { login: string } }>(`/repos/${repo}/pulls/${pr}`, token),
      comments(`/repos/${repo}/pulls/${pr}/comments`),
      comments(`/repos/${repo}/issues/${pr}/comments`),
      token ? githubApi<{ login: string }>("/user", token) : Promise.resolve(null),
    ]);
    const prData = { title: pull.title, state: pull.merged ? "MERGED" : pull.state.toUpperCase(), url: pull.html_url, headRefName: pull.head.ref, baseRefName: pull.base.ref, author: pull.user };

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
        isOwnComment: c.user.login === viewer?.login,
      }));

    return Response.json({
      pr: {
        title: prData.title,
        state: prData.state,
        url: prData.url,
        branch: prData.headRefName,
        headRepo: pull.head.repo?.full_name ?? null,
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
