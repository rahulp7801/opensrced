// Anti-slop guards, checked before spend and again at publish:
//   - somebody's open PR already targets the issue (issue timeline API)
//   - a maintainer asked for human-written work on the issue (same timeline)
//   - the user already has an open opensrcer PR in this repository
//   - the user hit the daily published-PR cap
//   - the project asks contributors to discuss or get assigned first
//   - the project bans AI-generated contributions
// Each guard returns a human-readable reason or null. Nothing here posts to
// GitHub; the discuss-first path hands the user a drafted comment to post
// themselves.

import { githubApi, githubGraphql } from "./github-api";
import { classifyAiPolicy, type AiStance, type ContribProfile } from "./contrib-profile";

export type TimelineEvent = {
  event?: string;
  source?: { type?: string; issue?: { number?: number; html_url?: string; state?: string; pull_request?: unknown; user?: { login?: string } | null } };
  // "commented" events
  body?: string;
  author_association?: string;
  html_url?: string;
  user?: { login?: string } | null;
};

// A maintainer turning AI-written work away on the issue itself (pallets/flask
// #6093: "Happy to review a human-written PR!"). Only the project's own people
// count, and the phrases are deliberately narrow: a false refusal costs one
// draft; a miss costs the maintainer's goodwill.
const MAINTAINER_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const AI_OBJECTION = [
  /\bhuman[- ](?:written|authored|made)\b/i,
  /\b(?:no|not|don'?t|do not|won'?t|will not)\s+(?:accept(?:ing)?|want|take|merge|review)\b[^.\n]{0,40}\b(?:AI|LLM|ChatGPT|Copilot|AI[- ]generated|machine[- ]generated)\b/i,
  /\b(?:AI|LLM)[- ](?:generated|written)\b[^.\n]{0,60}\b(?:not (?:welcome|accepted)|will be closed|won'?t be (?:accepted|merged|reviewed))\b/i,
];

/** The first maintainer comment on an issue that asks for human-written work
 *  or refuses AI-generated PRs. Pure, for tests with a recorded fixture. */
export function maintainerAiObjection(events: TimelineEvent[]): { author: string; excerpt: string; url: string } | null {
  for (const e of events) {
    if (e.event !== "commented" || !MAINTAINER_ROLES.has(e.author_association ?? "") || !e.body) continue;
    const sentence = e.body.split(/(?<=[.!?])\s+|\n+/).find((s) => AI_OBJECTION.some((re) => re.test(s)));
    if (sentence) return { author: e.user?.login ?? "a maintainer", excerpt: sentence.trim().slice(0, 200), url: e.html_url ?? "" };
  }
  return null;
}

export function maintainerObjectionReason(o: { author: string; excerpt: string } | null): string | null {
  if (!o) return null;
  return `a maintainer asked for human-written work on this issue (@${o.author}: "${o.excerpt}"). opensrcer won't open an AI-assisted pull request here; you can still use this preview to write the fix yourself`;
}

/** Open pull requests that cross-reference an issue, from its timeline.
 *  Pure, for tests with a recorded fixture. */
export function openPrsFromTimeline(events: TimelineEvent[]): Array<{ number: number; url: string; author: string | null }> {
  const seen = new Map<number, { number: number; url: string; author: string | null }>();
  for (const e of events) {
    const issue = e.source?.issue;
    if (e.event !== "cross-referenced" || !issue?.pull_request || issue.state !== "open" || typeof issue.number !== "number") continue;
    seen.set(issue.number, { number: issue.number, url: issue.html_url ?? "", author: issue.user?.login ?? null });
  }
  return [...seen.values()];
}

/** An issue's timeline (cross-references and comments). Up to 300 events. */
export async function issueTimeline(repo: string, issue: number, token: string | undefined, signal?: AbortSignal) {
  const events: TimelineEvent[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await githubApi<TimelineEvent[]>(`/repos/${repo}/issues/${issue}/timeline?per_page=100&page=${page}`, token, undefined, signal);
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

export function competingPrReason(prs: Array<{ url: string }>): string | null {
  if (prs.length === 0) return null;
  return `${prs.length} open pull request${prs.length === 1 ? " already targets" : "s already target"} this issue (${prs.slice(0, 3).map((p) => p.url).join(", ")}). Review or help with ${prs.length === 1 ? "it" : "those"} instead of opening another.`;
}

/** The user's open opensrcer PRs in this repository (any issue). */
export async function openOpensrcerPrs(repo: string, login: string, token: string, signal?: AbortSignal): Promise<string[]> {
  // ponytail: first 100 open PRs; page through them if busy repos let duplicates slip by.
  const pulls = await githubApi<Array<{ html_url: string; head?: { ref?: string; user?: { login?: string } | null } }>>(
    `/repos/${repo}/pulls?state=open&per_page=100`, token, undefined, signal);
  return pulls.filter((p) => p.head?.ref?.startsWith("opensrcer/") && p.head.user?.login?.toLowerCase() === login.toLowerCase()).map((p) => p.html_url);
}

/** OPENSRCER_PRS_PER_REPO (default 1) and OPENSRCER_DAILY_PR_CAP (default 3). */
export function prCaps() {
  const n = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isSafeInteger(v) && v >= 0 ? v : fallback;
  };
  return { perRepo: n("OPENSRCER_PRS_PER_REPO", 1), daily: n("OPENSRCER_DAILY_PR_CAP", 3) };
}

/** How many PRs this user published in the last 24 hours, from timestamps. */
export function publishedInLastDay(publishedAt: Array<string | undefined>, now = Date.now()): number {
  return publishedAt.filter((t) => t && now - Date.parse(t) < 24 * 60 * 60_000).length;
}

const DISCUSS_PATTERNS = [
  /\b(?:open|file|create|start)\s+an?\s+(?:issue|discussion)\s+(?:first|before)/i,
  /\bdiscuss(?:ed)?\b[^.\n]{0,40}\b(?:first|before (?:you )?(?:start|open|submit|send|work))/i,
  // About the contributor being assigned, not "the PR will be assigned to a
  // reviewer" (vllm's guide): an ask/wait/must verb, or "assigned ... before".
  /\b(?:ask|wait|request)\s+(?:to\s+|until you are\s+)?(?:be|get)\s+assigned\b/i,
  /\b(?:must|should|need to|have to)\s+(?:first\s+)?(?:be|get)\s+assigned\b/i,
  /\bassigned\s+(?:to (?:you|yourself|the issue)\s+)?before\b/i,
  /\bcomment on the issue\b[^.\n]{0,40}\bbefore\b/i,
];

const DISCUSS_LABELS = /^(?:needs?[- ](?:discussion|triage|design|decision|investigation)|status:\s*needs[- ]\w+|rfc|proposal|discussion|question|awaiting[- ]\w+)$/i;

/** The project or the issue asks for discussion/assignment before a PR. */
export function discussFirstReason(contributingText: string, labels: string[]): string | null {
  const label = labels.find((l) => DISCUSS_LABELS.test(l.trim()));
  if (label) return `the issue is labeled "${label}", so maintainers have not settled on a fix yet`;
  for (const re of DISCUSS_PATTERNS) {
    const m = re.exec(contributingText);
    if (m) return `the contribution guide asks contributors to discuss or get assigned first ("${m[0].trim().slice(0, 120)}")`;
  }
  return null;
}

const POLICY_FILES = [
  "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "docs/contributing/README.md",
  "AGENTS.md", "AI_POLICY.md", ".github/PULL_REQUEST_TEMPLATE.md", ".github/pull_request_template.md",
];

export type RepoPolicy = { ai: AiStance; source: string | null; excerpt: string | null; discussFirst: string | null };

/** A repository's AI-contribution policy and discuss-first rule, read from
 *  its default branch in one GraphQL call, for the issue scanner. Uses the
 *  same classifiers as the run-time profile (lib/contrib-profile.ts). */
export async function fetchRepoPolicy(owner: string, repo: string, token: string, signal?: AbortSignal): Promise<RepoPolicy> {
  const fields = POLICY_FILES.map((f, i) => `f${i}: object(expression: ${JSON.stringify(`HEAD:${f}`)}) { ... on Blob { text } }`).join("\n");
  const data = await githubGraphql<{ repository: Record<string, { text?: string } | null> | null }>(
    `query Policy($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`, { owner, repo }, token, signal);
  let policy: RepoPolicy = { ai: "unknown", source: null, excerpt: null, discussFirst: null };
  const texts: string[] = [];
  POLICY_FILES.forEach((file, i) => {
    const text = data.repository?.[`f${i}`]?.text?.slice(0, 200_000);
    if (!text) return;
    texts.push(text);
    const c = classifyAiPolicy(text);
    if (c.stance === "ban" || (c.stance === "disclose" && policy.ai === "unknown")) policy = { ...policy, ai: c.stance, source: file, excerpt: c.excerpt };
  });
  return { ...policy, discussFirst: discussFirstReason(texts.join("\n"), []) };
}

export function aiBanReason(profile: Pick<ContribProfile, "aiPolicy">): string | null {
  if (profile.aiPolicy.stance !== "ban") return null;
  return `this project does not accept AI-generated contributions (${profile.aiPolicy.source}: "${profile.aiPolicy.excerpt}")`;
}

/** A comment the user can post on the issue themselves (never auto-posted):
 *  states the finding and asks before sending a PR. */
export function draftIssueComment(diagnosis: string | null, verified: boolean): string {
  const finding = diagnosis?.trim() ? diagnosis.trim().slice(0, 1200) : "I think I have found the cause of this.";
  return [
    "Hi, I'd like to help with this.",
    "",
    finding,
    "",
    verified
      ? "I have a small fix with a regression test that fails before the change and passes after it."
      : "I have a small candidate fix but have not been able to run the tests yet.",
    "Would a PR along these lines be welcome, or is someone already working on it?",
    "",
    "<sub>Drafted with AI assistance (opensrcer); I reviewed it before posting.</sub>",
  ].join("\n");
}
