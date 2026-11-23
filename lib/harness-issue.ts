// An issue and its discussion for the harness's read_issue tool, read with
// the site's own token: a student without gh still gets it, and a class
// behind one IP never meets GitHub's anonymous limit.

import { gh } from "./gh";
import { splitRepo } from "./ai-policy";

export const ISSUE_TEXT_MAX = 8_000;
export const COMMENT_TEXT_MAX = 1_200;
export const COMMENTS_MAX = 20;

/** `maintainer`: GitHub's OWNER/MEMBER/COLLABORATOR, or someone who merged one of the repository's recent PRs
 *  (a maintainer whose org membership is private shows as CONTRIBUTOR: pypa/packaging's henryiii). */
export type IssueComment = { author: string; association: string; maintainer: boolean; at: string; body: string };
export type OpenPull = { number: number; title: string; author: string; url: string };
export type IssueThread = {
  repo: string; number: number; title: string; state: string; url: string; body: string; comments: IssueComment[]; more_comments: number;
  /** Open PRs in this repository that reference the issue (someone may already be fixing it); null when the search failed. */
  open_prs: OpenPull[] | null;
  /** The repository's other open PRs, newest first (OTHER_PRS_MAX): one can fix the same thing without naming the
   *  issue (tempfile #446 fixes #444, opened before it). null when they couldn't be listed. */
  other_prs: OpenPull[] | null;
};

export const OTHER_PRS_MAX = 30;

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
    author: c.user?.login ?? "ghost", association: c.author_association ?? "NONE", maintainer: MAINTAINER_ROLES.has(c.author_association ?? ""), at: String(c.created_at ?? "").slice(0, 10), body: clip(c.body ?? "", COMMENT_TEXT_MAX),
  }));
  if (comments.some((c) => !c.maintainer)) {
    const mergers = await recentMergers(client, owner, name);
    for (const c of comments) c.maintainer ||= mergers.has(c.author);
  }
  const open_prs = await openPullsReferencing(client, owner, name, number);
  const other_prs = await otherOpenPulls(client, owner, name, new Set((open_prs ?? []).map((p) => p.number)));
  return { repo: `${owner}/${name}`, number, title: issue.title ?? "", state: issue.state ?? "open", url: issue.html_url ?? `https://github.com/${owner}/${name}/issues/${number}`, body: clip(issue.body ?? "", ISSUE_TEXT_MAX), comments, more_comments: Math.max(0, total - comments.length), open_prs, other_prs };
}

const MAINTAINER_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const MERGERS_SAMPLE = 50;

/** Who merged the repository's last MERGERS_SAMPLE merged PRs: the profile's own maintainer signal (maintainersOf).
 *  Empty when GitHub won't say, so a reply is then judged by its association alone. */
async function recentMergers(client: ReturnType<typeof gh>, owner: string, name: string): Promise<Set<string>> {
  try {
    const data = await client.graphql<{ repository: { pullRequests: { nodes: Array<{ mergedBy: { login: string } | null }> } } | null }>(
      `query Mergers($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequests(states: MERGED, last: $n) { nodes { mergedBy { login } } } } }`,
      { owner, name, n: MERGERS_SAMPLE },
    );
    return new Set((data.repository?.pullRequests.nodes ?? []).flatMap((n) => (n.mergedBy?.login ? [n.mergedBy.login] : [])));
  } catch {
    return new Set();
  }
}

type SearchItem = { number?: number; title?: string; body?: string | null; html_url?: string; user?: { login?: string } | null; pull_request?: unknown };

/** Open pull requests in owner/name whose title or description references the issue
 *  (#N or …/issues/N), newest first. Search, not the issue's timeline: the server's
 *  fine-grained token gets a timeline with every cross-reference left out.
 *  ponytail: the newest 30 hits for the number; a PR that names the issue only in a
 *  comment or a commit is missed. */
async function openPullsReferencing(client: ReturnType<typeof gh>, owner: string, name: string, number: number): Promise<OpenPull[] | null> {
  let items: SearchItem[];
  try {
    items = (await client.request("GET /search/issues", { q: `repo:${owner}/${name} is:pr is:open ${number}`, sort: "created", order: "desc", per_page: 30 })).data.items as SearchItem[];
  } catch {
    return null; // Shown as "couldn't check", never as "none".
  }
  // GitHub links "#12" but not "#12x": a reference ends at a non-word character.
  const names = new RegExp(`(?:#|/issues/)${number}(?!\\w)`);
  return items.flatMap((pr) => pr.pull_request && pr.number && names.test(`${pr.title ?? ""}\n${pr.body ?? ""}`)
    ? [{ number: pr.number, title: pr.title ?? "", author: pr.user?.login ?? "ghost", url: pr.html_url ?? "" }]
    : []);
}

/** The repository's newest open PRs, less those already listed as referencing the issue. */
async function otherOpenPulls(client: ReturnType<typeof gh>, owner: string, name: string, listed: Set<number>): Promise<OpenPull[] | null> {
  let pulls: Array<{ number: number; title?: string; html_url?: string; user?: { login?: string } | null }>;
  try {
    pulls = (await client.request("GET /repos/{owner}/{repo}/pulls", { owner, repo: name, state: "open", sort: "created", direction: "desc", per_page: OTHER_PRS_MAX })).data;
  } catch {
    return null;
  }
  return pulls.filter((p) => !listed.has(p.number)).map((p) => ({ number: p.number, title: p.title ?? "", author: p.user?.login ?? "ghost", url: p.html_url ?? "" }));
}

export const LISTED_ISSUES_MAX = 30;
export type ListedIssue = { number: number; title: string; url: string; labels: string[]; comments: number; opened: string; taken: string | null };
export type IssueList = { repo: string; issues: ListedIssue[] };

/** The repository's newest open issues for find_issues, each with who has taken it: an assignee, or an open
 *  PR that names it (#N or …/issues/N in its title or description, read from the open PRs themselves since
 *  the site's token sees no cross-references). Every recent issue of markedjs/marked and pypa/packaging had a PR.
 *  ponytail: the newest 100 open PRs; an older one that names an issue is missed (read_issue searches by number). */
export async function listOpenIssues(repoInput: string, token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN, fetchImpl?: typeof fetch): Promise<IssueList> {
  let owner: string, name: string;
  try { [owner, name] = splitRepo(repoInput); } catch { throw new IssueThreadError(422, "repo must be owner/name."); }
  if (!token) throw new IssueThreadError(503, "opensrcer can't read GitHub issues itself here. Sign in with gh (gh auth login) and list them with gh issue list.");
  const client = gh(token, fetchImpl ? { fetch: fetchImpl } : {});
  type RawIssue = { number: number; title?: string; html_url?: string; labels?: Array<string | { name?: string }>; comments?: number; created_at?: string; assignees?: Array<{ login?: string }> | null; pull_request?: unknown };
  let raw: RawIssue[];
  try {
    // /issues lists PRs too: a full page, trimmed after they're dropped.
    raw = (await client.request("GET /repos/{owner}/{repo}/issues", { owner, repo: name, state: "open", sort: "created", direction: "desc", per_page: 100 })).data as RawIssue[];
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 410) throw new IssueThreadError(404, `${owner}/${name} wasn't found, or its issues are turned off.`);
    throw error;
  }
  const pulls = (await client.request("GET /repos/{owner}/{repo}/pulls", { owner, repo: name, state: "open", sort: "created", direction: "desc", per_page: 100 })).data as Array<{ number: number; title?: string; body?: string | null }>;
  const naming = new Map<number, number[]>();
  for (const pr of pulls) {
    for (const m of `${pr.title ?? ""}\n${pr.body ?? ""}`.matchAll(/(?:#|\/issues\/)(\d+)(?!\w)/g)) {
      const n = Number(m[1]);
      if (!naming.get(n)?.includes(pr.number)) naming.set(n, [...(naming.get(n) ?? []), pr.number]);
    }
  }
  const issues = raw.filter((i) => !i.pull_request).slice(0, LISTED_ISSUES_MAX).map((i) => {
    const assignees = (i.assignees ?? []).flatMap((a) => (a.login ? [`@${a.login}`] : []));
    const prs = naming.get(i.number) ?? [];
    const taken = assignees.length ? `assigned to ${assignees.join(", ")}` : prs.length ? `open PR ${prs.map((n) => `#${n}`).join(", ")}` : null;
    return {
      number: i.number, title: i.title ?? "", url: i.html_url ?? `https://github.com/${owner}/${name}/issues/${i.number}`,
      labels: (i.labels ?? []).flatMap((l) => (typeof l === "string" ? [l] : l.name ? [l.name] : [])),
      comments: i.comments ?? 0, opened: String(i.created_at ?? "").slice(0, 10), taken,
    };
  });
  return { repo: `${owner}/${name}`, issues };
}
