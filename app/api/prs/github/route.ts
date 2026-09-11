import { requireSession } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { githubGraphql } from "@/lib/github-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauth = await requireSession();
  if (unauth) return unauth;
  const token = await resolveGitHubToken();
  if (!token) return Response.json({ error: "Sign in with GitHub to view your pull requests." }, { status: 401 });
  try {
    type Pull = { repository: { nameWithOwner: string }; title: string; number: number; url: string; state: string;
      createdAt: string; updatedAt: string; headRefName: string; baseRefName: string; additions: number;
      deletions: number; reviewDecision: string | null; isDraft: boolean; comments: { totalCount: number } };
    const data = await githubGraphql<{ viewer: { login: string; pullRequests: { nodes: Pull[] } } }>(`
      query MyPullRequests {
        viewer {
          login
          pullRequests(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { repository { nameWithOwner } title number url state createdAt updatedAt
              headRefName baseRefName additions deletions reviewDecision isDraft comments { totalCount } }
          }
        }
      }`, {}, token);
    const prs = data.viewer.pullRequests.nodes.map((pr) => ({
      repo: pr.repository.nameWithOwner, title: pr.title, number: pr.number, url: pr.url,
      state: pr.state, createdAt: pr.createdAt, updatedAt: pr.updatedAt, branch: pr.headRefName,
      base: pr.baseRefName, additions: pr.additions, deletions: pr.deletions,
      reviewDecision: pr.reviewDecision ?? "", isDraft: pr.isDraft, commentCount: pr.comments.totalCount,
    }));
    return Response.json({ login: data.viewer.login, prs });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "GitHub request failed." }, { status: 502 });
  }
}
