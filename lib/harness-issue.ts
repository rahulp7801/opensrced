// An issue and its discussion for the harness's read_issue tool, read with
// the site's own token: a student without gh still gets it, and a class
// behind one IP never meets GitHub's anonymous limit.

import { gh } from "./gh";
import { splitRepo } from "./ai-policy";
import { detectResolved, notReadyLabel } from "./issues";

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
/** Pages of 100 open PRs find_issues reads for ones naming an issue. */
export const OPEN_PULLS_PAGES = 5;
export type ListedIssue = {
  number: number; title: string; url: string; labels: string[]; comments: number; opened: string; taken: string | null;
  /** Why it may already be fixed (a label, its text or a newest comment), or null (lib/issues.ts detectResolved). */
  resolved: string | null;
  /** Why its labels say it isn't ready to work on (waiting for triage, for information, a decision), or null. */
  notReady: string | null;
};
export type IssueList = { repo: string; issues: ListedIssue[] };

/** Someone saying they're on it. Where only collaborators can open PRs (uvicorn, starlette), a claim or a
 *  ready branch in the issue is all there is. ponytail: first-person phrases only; a claim gone stale still counts. */
const CLAIM = /\b(?:(?:i'?ll|i\s+will|i'?d\s+like\s+to|let\s+me)\s+(?:take|work\s+on|pick\s+up|tackle|grab)\s+(?:this|it)\b|(?:i'?m|i\s+am)\s+interested\s+in\s+(?:working\s+on|taking|picking\s+up|fixing)\s+(?:this|it)\b|(?:i'?m|i\s+am|we'?re|we\s+are|our\s+team\s+is)\s+(?:already\s+)?working\s+on\s+(?:this|it|a\s+fix)\b|(?:ready|my)\s+fix\s+branch\b|(?:i'?ll|i\s+will)\s+open\s+a\s+(?:pr|pull\s+request)\b|opening\s+a\s+(?:pr|pull\s+request)\b|(?:i\s+have|i'?ve\s+got)\s+(?:a\s+)?(?:fix|patch|branch)\b(?!\s+(?:idea|suggestion|proposal|in\s+mind))|(?:i\s+have|i'?ve\s+got)\s+a\s+draft\b(?:\s+\w+){0,2}\s+ready\b|i(?:'ve|\s+have)?\s+(?:just\s+)?(?:opened|submitted|created|raised|sent)\s+(?:a\s+(?:pr|pull\s+request|fix)\b|[\w.-]+\/[\w.-]+#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+))/i;

function claimIn(i: IssueNode): string | null {
  const m = CLAIM.exec(i.body ?? "");
  if (m) return `the issue says "${m[0]}"`;
  for (const c of [...i.comments.nodes].reverse()) {
    const hit = CLAIM.exec(c.body);
    if (hit) return `claimed by @${c.author?.login ?? "ghost"}: "${hit[0]}"`;
    if (PATCH.test(c.body)) return `a patch is posted in a comment by @${c.author?.login ?? "ghost"}`;
  }
  return null;
}

/** A diff in a comment: the fix exists already (scrapy #8427), and a lesson's answer is in the thread. */
const PATCH = /^```(?:diff|patch)\b|^--- a\/.*\n\+\+\+ b\//m;

type IssueNode = {
  number: number; title: string; url: string; body: string | null; createdAt: string;
  labels: { nodes: Array<{ name: string }> }; assignees: { nodes: Array<{ login: string }> };
  comments: { totalCount: number; nodes: Array<{ body: string; author: { login: string } | null; authorAssociation: string; createdAt: string }> };
};

/** The repository's newest open issues for find_issues, each with who has taken it: an assignee, or an open
 *  PR that names it (#N or …/issues/N in its title or description, read from the open PRs themselves since
 *  the site's token sees no cross-references). Every recent issue of markedjs/marked and pypa/packaging had a PR.
 *  Its newest comments are read too: open issues are often fixed on main already (cheerio #5368), and a
 *  comment linking an open PR takes the issue as surely as the PR naming it (bat #3738: "PR: …/pull/3746").
 *  ponytail: the newest OPEN_PULLS_PAGES × 100 open PRs (bat and tqdm have ~240); past that a PR naming an
 *  issue is missed (read_issue searches by number). */
export async function listOpenIssues(repoInput: string, token = process.env.OPENSRCER_INGEST_GITHUB_TOKEN, fetchImpl?: typeof fetch): Promise<IssueList> {
  let owner: string, name: string;
  try { [owner, name] = splitRepo(repoInput); } catch { throw new IssueThreadError(422, "repo must be owner/name."); }
  if (!token) throw new IssueThreadError(503, "opensrcer can't read GitHub issues itself here. Sign in with gh (gh auth login) and list them with gh issue list.");
  const client = gh(token, fetchImpl ? { fetch: fetchImpl } : {});
  const missing = new IssueThreadError(404, `${owner}/${name} wasn't found, or its issues are turned off.`);
  // "Not found" only when REST agrees (GraphQL has answered no repository for a moment: nodejs/node).
  const confirmMissing = async (cause: unknown): Promise<Error> => {
    try {
      const { data } = await client.request("GET /repos/{owner}/{repo}", { owner, repo: name });
      if ((data as { has_issues?: boolean }).has_issues === false) return missing;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return missing;
    }
    return cause instanceof Error ? cause : new Error(String(cause));
  };
  let repo: { hasIssuesEnabled: boolean; issues: { nodes: IssueNode[] } } | null;
  try {
    repo = (await client.graphql<{ repository: typeof repo }>(
      `query OpenIssues($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { hasIssuesEnabled
        issues(first: $n, states: OPEN, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number title url body createdAt
          labels(first: 20) { nodes { name } } assignees(first: 5) { nodes { login } }
          comments(last: 5) { totalCount nodes { body author { login } authorAssociation createdAt } } } } } }`,
      { owner, name, n: LISTED_ISSUES_MAX },
    )).repository;
  } catch (error) {
    // A missing repository is a GraphQL error of type NOT_FOUND, not a 404.
    const { errors, status } = error as { errors?: Array<{ type?: string }>; status?: number };
    if (status === 404 || (errors?.length && errors.every((e) => e.type === "NOT_FOUND"))) throw await confirmMissing(error);
    throw error;
  }
  if (!repo) throw await confirmMissing(new Error(`GitHub didn't return ${owner}/${name}'s issues.`));
  if (!repo.hasIssuesEnabled) throw missing;
  const pulls: Array<{ number: number; title?: string; body?: string | null }> = [];
  for (let page = 1; page <= OPEN_PULLS_PAGES; page++) {
    const batch = (await client.request("GET /repos/{owner}/{repo}/pulls", { owner, repo: name, state: "open", sort: "created", direction: "desc", per_page: 100, page })).data as typeof pulls;
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  const naming = new Map<number, number[]>();
  const add = (issue: number, pr: number) => { if (!naming.get(issue)?.includes(pr)) naming.set(issue, [...(naming.get(issue) ?? []), pr]); };
  for (const pr of pulls) {
    for (const m of `${pr.title ?? ""}\n${pr.body ?? ""}`.matchAll(/(?:#|\/issues\/)(\d+)(?!\w)/g)) add(Number(m[1]), pr.number);
  }
  // The issue or a newest comment naming one of this repository's open PRs, by link or as "#N" (fastify #7038:
  // "#6957 (approved, not yet merged) fixes this"). A closed PR, or an issue number, isn't taking it.
  // ponytail: an open PR named in passing ("unlike #6957") counts too; read_issue shows the comment.
  const open = new Set(pulls.map((p) => p.number));
  const prLink = new RegExp(`github\\.com/${`${owner}/${name}`.replace(/\./g, "\\.")}/pull/(\\d+)(?!\\d)|(?<![\\w/&])#(\\d+)(?!\\w)`, "gi");
  for (const i of repo.issues.nodes) {
    for (const text of [i.body ?? "", ...i.comments.nodes.map((c) => c.body)]) {
      for (const m of text.matchAll(prLink)) {
        const n = Number(m[1] ?? m[2]);
        if (open.has(n) && n !== i.number) add(i.number, n);
      }
    }
  }
  const issues = repo.issues.nodes.map((i) => {
    const assignees = i.assignees.nodes.map((a) => `@${a.login}`);
    const prs = naming.get(i.number) ?? [];
    const claim = claimIn(i);
    const taken = assignees.length ? `assigned to ${assignees.join(", ")}` : prs.length ? `open PR ${prs.map((n) => `#${n}`).join(", ")}` : claim;
    const labels = i.labels.nodes.map((l) => l.name);
    return {
      number: i.number, title: i.title, url: i.url, labels, comments: i.comments.totalCount, opened: i.createdAt.slice(0, 10), taken,
      resolved: detectResolved(i.title, i.body ?? "", labels, i.comments.nodes)?.reason ?? null,
      // notReadyLabel expects lowercase labels, as lib/issues.ts scoreIssue passes them.
      notReady: notReadyLabel(labels.map((l) => l.toLowerCase())),
    };
  });
  return { repo: `${owner}/${name}`, issues };
}
