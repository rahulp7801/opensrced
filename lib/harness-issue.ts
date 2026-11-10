// An issue and its discussion for the harness's read_issue tool, read with
// the site's own token: a student without gh still gets it, and a class
// behind one IP never meets GitHub's anonymous limit.

import { gh } from "./gh";
import { splitRepo } from "./ai-policy";

export const ISSUE_TEXT_MAX = 8_000;
export const COMMENT_TEXT_MAX = 1_200;
export const COMMENTS_MAX = 20;

export type IssueComment = { author: string; association: string; at: string; body: string };
export type IssueThread = { repo: string; number: number; title: string; state: string; url: string; body: string; comments: IssueComment[]; more_comments: number };

/** The site can't read it: no token here, no such issue, or a pull request. */
export class IssueThreadError extends Error {
  constructor(readonly status: 404 | 422 | 503, message: string) { super(message); }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [cut]` : text);

/** The issue and its newest comments (oldest first), clipped. Validates before calling GitHub. */
export async function readIssueThread(repoInput: string, numberInput: unknown, token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN, fetchImpl?: typeof fetch): Promise<IssueThread> {
  let owner: string, name: string;
  try { [owner, name] = splitRepo(repoInput); } catch { throw new IssueThreadError(422, "repo must be owner/name."); }
  const number = Number(numberInput);
  if (!Number.isSafeInteger(number) || number < 1) throw new IssueThreadError(422, "issue must be the issue's number.");
  if (!token) throw new IssueThreadError(503, "opensrcer can't read GitHub issues itself here. Sign in with gh (gh auth login) and read it with gh issue view.");
  const client = gh(token, fetchImpl ? { fetch: fetchImpl } : {});
  let issue: { title?: string | null; body?: string | null; state?: string; html_url?: string; comments?: number; pull_request?: unknown };
  try {
    issue = (await client.request("GET /repos/{owner}/{repo}/issues/{issue_number}", { owner, repo: name, issue_number: number })).data;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 410) throw new IssueThreadError(404, `${owner}/${name} has no issue #${number}.`);
    throw error;
  }
  if (issue.pull_request) throw new IssueThreadError(422, `#${number} is a pull request, not an issue.`);
  const total = issue.comments ?? 0;
  // The newest COMMENTS_MAX: where an issue stands is in its latest replies.
  const page = Math.max(1, Math.ceil(total / COMMENTS_MAX));
  const raw = total ? (await client.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", { owner, repo: name, issue_number: number, per_page: COMMENTS_MAX, page })).data : [];
  const comments = (raw as Array<{ user?: { login?: string } | null; author_association?: string; created_at?: string; body?: string | null }>).map((c) => ({
    author: c.user?.login ?? "ghost", association: c.author_association ?? "NONE", at: String(c.created_at ?? "").slice(0, 10), body: clip(c.body ?? "", COMMENT_TEXT_MAX),
  }));
  return { repo: `${owner}/${name}`, number, title: issue.title ?? "", state: issue.state ?? "open", url: issue.html_url ?? `https://github.com/${owner}/${name}/issues/${number}`, body: clip(issue.body ?? "", ISSUE_TEXT_MAX), comments, more_comments: Math.max(0, total - comments.length) };
}
