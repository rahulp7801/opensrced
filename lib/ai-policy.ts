// A repository's stance on AI-assisted contributions, read from GitHub before
// a lesson starts and again at publish (always on: a PR the project's own
// policy forbids is wasted work for the contributor and the maintainer).
//
// The files are found, not guessed: one GraphQL query lists the root, .github/
// and docs/ directories (plus the PR templates GitHub itself knows about), file
// names are matched case-insensitively (nbQA keeps docs/contributing.rst), a
// second query reads the matches, and a third follows symlinks and
// reStructuredText / MyST includes once (earthpy's docs/contributing.rst is
// ".. include:: ../CONTRIBUTING.rst"). Every file is classified by
// lib/contrib-profile.ts classifyAiPolicy, the same rules the run's clone-based
// profile uses. The matched sentence comes back as evidence so a refusal or a
// disclosure can quote the project's own words.
//
// Alongside the stance: the agent instruction files the project publishes
// (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md) and any passage
// addressed to AI agents (movingpandas: "If you are an automated agent ... add
// 🤖🤖🤖 to the end of the PR title"), quoted so a human sees it and nothing
// obeys it silently. All fixed patterns; nothing here is written by a model.

import { classifyAiPolicy, type AiStance } from "./contrib-profile";
import type { GitHubClient } from "./gh";
import { sanitizeGitHubName } from "./sanitize";

export type AiPolicyStance = "banned" | "disclosure-required" | "allowed" | "unknown";
/** `source` is the file the stance came from; `evidence` its matched sentence. */
export type RepoAiPolicy = { stance: AiPolicyStance; source: string | null; evidence: string | null };
/** An instruction file for AI agents, by its path on the default branch. */
export type AgentFile = { path: string; bytes: number };
/** A passage addressed to AI agents, quoted (trimmed to ~300 chars) from `path`. */
export type AgentDirective = { path: string; text: string };
/** What fetchAiPolicy reads: the stance plus what the project says to agents. */
export type RepoAiReading = RepoAiPolicy & { agentFiles: AgentFile[]; agentDirectives: AgentDirective[]; procedures: ProcedureRule[] };

const STANCE: Record<AiStance, AiPolicyStance> = { ban: "banned", disclose: "disclosure-required", welcome: "allowed", unknown: "unknown" };
/** A ban anywhere outranks a disclosure rule, which outranks a welcome. */
const RANK: Record<AiPolicyStance, number> = { unknown: 0, allowed: 1, "disclosure-required": 2, banned: 3 };

/** The directories listed for policy files ("" is the root). Sphinx projects keep theirs under doc/
 *  (numpy's doc/source/dev/ai_policy.rst, pandas' doc/source/development/, matplotlib's doc/devel/). */
export const AI_POLICY_DIRS = ["", ".github", "docs", "doc", "doc/source/dev", "doc/source/development", "doc/devel", "docs/source/development", "docs/development", "Documentation"] as const;

/** Whether a listed file is a contribution guide / AI policy, an agent
 *  instruction file, or neither. Case-insensitive; CONTRIBUTORS.* is a list
 *  of names, not a guide. PR templates come from GitHub's own list instead. */
export function policyFileRole(path: string): "guide" | "agent" | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/^(?:agents|claude)\.md$/i.test(name) || /^\.github\/copilot-instructions\.md$/i.test(path)) return "agent";
  // matplotlib's guide is doc/devel/contribute.rst, git's Documentation/SubmittingPatches, LLVM's AIToolPolicy.md.
  if (/^(?:contribut(?:ing|e)|submitting[-_ ]?patches|ai(?:[-_ ]?(?:tools?[-_ ]?)?(?:policy|usage|contributions?))?)(?:\.(?:md|rst|txt|adoc))?$/i.test(name)) return "guide";
  return null;
}

/** How long a repo's policy is reused before it is read again. */
export const AI_POLICY_TTL_MS = 6 * 60 * 60_000;
const MAX_FILE_CHARS = 200_000;
const MAX_DIRECTIVES = 10;
const DIRECTIVE_CHARS = 300;
/** A tree entry's git mode for a symbolic link (0o120000). */
const SYMLINK_MODE = 40960;

export class InvalidRepoNameError extends Error {
  constructor(repo: string) {
    super(`Not an owner/name repository: ${JSON.stringify(repo.slice(0, 100))}`);
    this.name = "InvalidRepoNameError";
  }
}

/** GitHub could not be read, or the repository is missing. */
export class AiPolicyFetchError extends Error {
  constructor(repo: string, cause?: unknown) {
    super(`Could not read ${repo}'s contribution guide to check its AI policy.`, { cause });
    this.name = "AiPolicyFetchError";
  }
}

/** The strictest stance across the files, with the sentence that set it. Pure. */
export function classifyRepoAiPolicy(files: Array<{ path: string; text: string }>): RepoAiPolicy {
  let policy: RepoAiPolicy = { stance: "unknown", source: null, evidence: null };
  for (const { path, text } of files) {
    const c = classifyAiPolicy(text.slice(0, MAX_FILE_CHARS));
    const stance = STANCE[c.stance];
    if (RANK[stance] > RANK[policy.stance]) policy = { stance, source: path, evidence: c.excerpt };
  }
  return policy;
}

/** The AI stance one piece of text takes (a maintainer's review comment,
 *  say), with its sentence; null when it says nothing about AI. Pure. */
export function aiStatementIn(text: string): { stance: AiPolicyStance; excerpt: string } | null {
  const c = classifyAiPolicy(text.slice(0, MAX_FILE_CHARS));
  return c.stance === "unknown" || !c.excerpt ? null : { stance: STANCE[c.stance], excerpt: c.excerpt };
}

const AGENT_KIND = String.raw`(?:AI|LLM|automated|autonomous|coding|language[- ]model|generative)`;
/** An HTML comment telling its reader what they must do (checked in agent files only). */
const HIDDEN_DIRECTIVE = /<!--(?:(?!-->)[\s\S]){0,400}?\byou\s+(?:must|should|shall|are\s+required\s+to)\b/gi;

/** Text that speaks to an AI agent rather than about one. "the agent class"
 *  or "agent-based models" do not match: each pattern needs the agent to be
 *  addressed ("if you are an ...", "attention ...", "... reading this") or
 *  told what it must do. */
const DIRECTIVE_PATTERNS = [
  // movingpandas: "If you are an automated agent, we have a streamlined process ..."
  new RegExp(String.raw`\bif\s+you(?:'re|’re|\s+are)\s+(?:an?\s+)?(?:${AGENT_KIND}[- ]?(?:coding\s+)?(?:agent|assistant|model|bot|tool)s?|AI|LLM|large\s+language\s+model|agent)(?![-\w])`, "gi"),
  // Agents/assistants only: "AI models should be saved with save()" is an ML library's docs.
  new RegExp(String.raw`\b(?:AI|LLM|coding)\s+(?:agents?|assistants?)\s+(?:must|should|shall|need\s+to|are\s+required\s+to)\b`, "gi"),
  /\battention\s*[:,-]?\s*(?:all\s+)?(?:AI|LLMs?|agents?|language\s+models?)\b/gi,
  /\b(?:AI|LLMs?|agents?|assistants?|language\s+models?)\s+reading\s+this\b/gi,
  /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions\b/gi,
];

/** The paragraph around `index`, whitespace collapsed; when it is longer than
 *  DIRECTIVE_CHARS, from the matched sentence on, so the quote keeps the match. */
function paragraphAround(text: string, index: number, matchLength: number): string {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(/\n[ \t]*\n/g)) {
    if (m.index >= index) { end = m.index; break; }
    start = m.index + m[0].length;
  }
  const head = text.slice(start, index).replace(/\s+/g, " ").trimStart();
  const para = (head + text.slice(index, end).replace(/\s+/g, " ")).trim();
  if (para.length <= DIRECTIVE_CHARS) return para;
  let from = head.lastIndexOf(". ") + 1; // 0 when the match is in the first sentence
  if (head.length - from + matchLength > DIRECTIVE_CHARS) from = head.length;
  return para.slice(from, from + DIRECTIVE_CHARS).trim();
}

/** A written step the project requires before a pull request. */
export type ProcedureKind = "approval" | "assignment" | "issue_first" | "discussion";
export type ProcedureRule = { kind: ProcedureKind; path: string; text: string };

/** earthpy's template: "Only submit a PR after … Getting approval from one of
 *  the maintainers"; its guide: "first create an issue … Once a discussion has
 *  yielded a vote of support … submit a pull request". Checked in this order. */
const PROCEDURE_PATTERNS: Array<[ProcedureKind, RegExp]> = [
  // Approval before the PR, not to merge it ("needs approval from two maintainers to merge" is review).
  ["approval", /\b(only (submit|open) a (pr|pull request) after|(get(ting)?|obtain(ing)?|wait(ing)? for)\b[^.\n]{0,40}\b(approval|a vote of support|the go-ahead)\b[^.\n]{0,40}\bbefore\b[^.\n]{0,30}\b(pr|pull request|submit|open)|vote of support\b[^.\n]{0,80}\b(submit|open) a (pr|pull request)|(don'?t|do not|never) (open|submit|send) an? (pr|pull request)\b[^.\n]{0,20}\bunless (you('re| are| were) )?(invited|asked))/i],
  ["assignment", /\b((ask|wait) to be assigned|(be|get|getting) assigned (to )?(the |an )?issue|assign (the issue|it) to yourself|assign yourself( to)? (it|the issue|an issue)|without being assigned)\b/i],
  ["issue_first", /\b((open|create|file) an issue (first|before)|first (open|create|file) an issue|before (opening|submitting|sending) a (pr|pull request)[^.\n]{0,60}\bissue\b)/i],
  // Django: "non-trivial pull requests (anything more than fixing a typo) without\nTrac tickets will be closed!"
  ["issue_first", /\b(pull requests?|prs?)\b[^.]{0,80}?\bwithout\s+(\w+\s+)?(issues?|tickets?)\b[^.]{0,20}?\b(will be|are|get)\s+closed/i],
  ["discussion", /\b(discuss(ed|ion)?\b[^.\n]{0,40}\bbefore\b[^.\n]{0,40}\b(pr|pull request|implement)|before (opening|submitting|sending) a (pr|pull request)[^.\n]{0,60}\bdiscuss)/i],
];

/** The pre-PR steps the guides and PR templates write down, one quote per
 *  kind, in file order. Written rules count however few PRs a project has. Pure. */
export function procedureRulesIn(files: Array<{ path: string; text: string }>): ProcedureRule[] {
  const out: ProcedureRule[] = [];
  for (const { path, text } of files) {
    const body = text.slice(0, MAX_FILE_CHARS);
    for (const [kind, re] of PROCEDURE_PATTERNS) {
      if (out.some((r) => r.kind === kind)) continue;
      const m = re.exec(body);
      if (m) out.push({ kind, path, text: paragraphAround(body, m.index, m[0].length) });
    }
  }
  return out;
}

/** Each passage in `files` addressed to AI agents, quoted, deduplicated, at
 *  most MAX_DIRECTIVES in file order. Pure. */
export function agentDirectivesIn(files: Array<{ path: string; text: string }>): AgentDirective[] {
  const out: AgentDirective[] = [];
  for (const { path, text } of files) {
    const body = text.slice(0, MAX_FILE_CHARS);
    // In an agent file, an instruction hidden in an HTML comment is for the agent alone (Next.js's AGENTS.md:
    // "<!--... you MUST include the following HTML comment ...: <!-- NEXT_JS_LLM -->"). PR templates' comments are for people.
    const patterns = policyFileRole(path) === "agent" ? [...DIRECTIVE_PATTERNS, HIDDEN_DIRECTIVE] : DIRECTIVE_PATTERNS;
    const hits = patterns.flatMap((re) => [...body.matchAll(re)]).sort((a, b) => a.index - b.index);
    for (const m of hits) {
      const quote = paragraphAround(body, m.index, m[0].length);
      if (out.some((d) => d.path === path && d.text === quote)) continue;
      out.push({ path, text: quote });
      if (out.length >= MAX_DIRECTIVES) return out;
    }
  }
  return out;
}

/** The files a guide pulls in with reStructuredText `.. include:: <path>` or
 *  MyST ```{include} <path>```, resolved from the guide's own directory
 *  (same rules as symlinkTarget). At most 5. Exported for tests. */
export function includeTargets(path: string, text: string): string[] {
  const found = [...text.matchAll(/^[ \t]*(?:\.\.[ \t]+include::|(?:```|:::)\{include\})[ \t]*(\S+)/gm)]
    .map((m) => symlinkTarget(path, m[1]))
    .filter((t): t is string => !!t);
  return [...new Set(found)].slice(0, 5);
}

/** "owner/name" split and checked; throws InvalidRepoNameError. */
export function splitRepo(repo: string): [string, string] {
  const [owner, name, extra] = repo.split("/");
  if (extra !== undefined || !owner || !name || !sanitizeGitHubName(owner) || !sanitizeGitHubName(name)) throw new InvalidRepoNameError(repo);
  return [owner, name];
}

/** The path a symlink points at, resolved from its own directory, or null.
 *  GraphQL hands back a symlink's target as its text: pydantic's root
 *  CONTRIBUTING.md is "docs/contributing.md". Exported for tests. */
export function symlinkTarget(path: string, text: string): string | null {
  const target = text.trim();
  if (target.includes("\n") || target.length > 200 || !/^[\w./-]+\.(md|rst|txt)$/i.test(target)) return null;
  const parts = path.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") { if (!parts.length) return null; parts.pop(); }
    else if (segment !== "." && segment) parts.push(segment);
  }
  return parts.join("/");
}

/** One query on the repository's fields; throws AiPolicyFetchError. */
async function queryRepo<T>(client: GitHubClient, repo: string, owner: string, name: string, fields: string): Promise<T> {
  let data: { repository: T | null } | null;
  try {
    data = await client.graphql<{ repository: T | null }>(`query AiPolicy($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, { owner, name });
  } catch (error) {
    throw new AiPolicyFetchError(repo, error);
  }
  if (!data?.repository) throw new AiPolicyFetchError(repo);
  return data.repository;
}

/** The text of each path that exists on the default branch. */
async function readFiles(client: GitHubClient, repo: string, owner: string, name: string, paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const fields = paths.map((f, i) => `f${i}: object(expression: ${JSON.stringify(`HEAD:${f}`)}) { ... on Blob { text } }`).join("\n");
  const data = await queryRepo<Record<string, { text?: string | null } | null>>(client, repo, owner, name, fields);
  return new Map(paths.flatMap((path, i) => {
    const text = data[`f${i}`]?.text;
    return text ? [[path, text] as const] : [];
  }));
}

type TreeEntry = { name: string; type: string; mode: number };
type Listing = Record<string, { entries?: TreeEntry[] } | null> & {
  pullRequestTemplates?: Array<{ filename: string; body: string | null }> | null;
};

/** Read the policy files from GitHub (no cache): list the policy directories
 *  and GitHub's PR templates, read the matching files, then follow symlinks
 *  and includes once. Throws AiPolicyFetchError. */
export async function fetchAiPolicy(client: GitHubClient, repo: string): Promise<RepoAiReading> {
  const [owner, name] = splitRepo(repo);
  const listing = await queryRepo<Listing>(client, repo, owner, name, [
    "pullRequestTemplates { filename body }",
    ...AI_POLICY_DIRS.map((dir, i) => `d${i}: object(expression: ${JSON.stringify(`HEAD:${dir}`)}) { ... on Tree { entries { name type mode } } }`),
  ].join("\n"));

  const roles = new Map<string, "guide" | "agent">();
  const links = new Set<string>();
  const listed = new Map<string, string>(); // file name -> first path it is listed at
  AI_POLICY_DIRS.forEach((dir, i) => {
    for (const entry of listing[`d${i}`]?.entries ?? []) {
      if (entry.type !== "blob") continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (!listed.has(entry.name)) listed.set(entry.name, path);
      const role = policyFileRole(path);
      if (!role) continue;
      roles.set(path, role);
      if (entry.mode === SYMLINK_MODE) links.add(path);
    }
  });
  const found = await readFiles(client, repo, owner, name, [...roles.keys()]);

  // One hop: a symlink is replaced by its target; an include adds the included file.
  const follow = new Map<string, string>();
  for (const link of links) {
    const target = found.has(link) ? symlinkTarget(link, found.get(link)!) : null;
    if (target) follow.set(link, target);
    found.delete(link);
  }
  const included = [...found].flatMap(([path, text]) => includeTargets(path, text));
  const wanted = [...new Set([...follow.values(), ...included])].filter((path) => !found.has(path));
  const second = await readFiles(client, repo, owner, name, wanted);
  for (const [link, target] of follow) {
    if (roles.get(link) === "agent") roles.set(target, "agent");
  }
  for (const [path, text] of second) {
    found.set(path, text);
    if (!roles.has(path)) roles.set(path, "guide");
  }

  const files = [...found].map(([path, text]) => ({ path, text }));
  const own = new Set([...roles].filter(([, role]) => role === "guide").map(([path]) => path.slice(path.lastIndexOf("/") + 1).toLowerCase()));
  const org = await orgGuideFiles(client, owner, name);
  for (const t of listing.pullRequestTemplates ?? []) {
    // GitHub names a template by file name only; templates in a
    // PULL_REQUEST_TEMPLATE/ directory are not in the listing.
    if (t.body) files.push({ path: listed.get(t.filename) ?? `PULL_REQUEST_TEMPLATE/${t.filename}`, text: t.body });
  }
  // The org's AI stance holds for all its repos (pallets/click's own docs/contributing.md
  // says nothing, pallets/.github's CONTRIBUTING.md closes AI PRs on sight); its written
  // steps only where the repo has no guide of that name (as GitHub shows them).
  const orgSteps = org.filter((f) => !own.has(f.path.slice(f.path.lastIndexOf("/") + 1).toLowerCase()));
  return {
    ...classifyRepoAiPolicy([...files, ...org]),
    agentFiles: files.filter((f) => roles.get(f.path) === "agent").map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.text).length })),
    agentDirectives: agentDirectivesIn(files),
    procedures: procedureRulesIn([...files.filter((f) => roles.get(f.path) !== "agent"), ...orgSteps]),
  };
}

/** The guides and AI policies the owner's `.github` repository publishes for all its repos
 *  (as GitHub does for community health files): marshmallow's AI_POLICY.md lives only in
 *  marshmallow-code/.github. Quoted as "owner/.github/AI_POLICY.md". An owner without a
 *  `.github` repo has none; agent files there are not the repo's. Throws
 *  AiPolicyFetchError when GitHub can't be read. */
async function orgGuideFiles(client: GitHubClient, owner: string, name: string): Promise<Array<{ path: string; text: string }>> {
  if (name.toLowerCase() === ".github") return [];
  const org = `${owner}/.github`;
  let listing: Listing;
  try {
    listing = await queryRepo<Listing>(client, org, owner, ".github", AI_POLICY_DIRS.map((dir, i) => `d${i}: object(expression: ${JSON.stringify(`HEAD:${dir}`)}) { ... on Tree { entries { name type } } }`).join("\n"));
  } catch (error) {
    // No such repository: GitHub answers NOT_FOUND (or a null repository: no cause).
    const errors = (error as { cause?: { errors?: Array<{ type?: string }> } }).cause?.errors;
    if (error instanceof AiPolicyFetchError && (error.cause === undefined || (errors?.length && errors.every((e) => e.type === "NOT_FOUND")))) return [];
    throw error;
  }
  const paths = new Map<string, string>(); // file name -> first path it is listed at
  AI_POLICY_DIRS.forEach((dir, i) => {
    for (const entry of listing[`d${i}`]?.entries ?? []) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.type === "blob" && policyFileRole(path) === "guide" && !paths.has(entry.name.toLowerCase())) paths.set(entry.name.toLowerCase(), path);
    }
  });
  const read = await readFiles(client, org, owner, ".github", [...paths.values()]);
  return [...read].map(([path, text]) => ({ path: `${org}/${path}`, text }));
}

// ponytail: per-instance cache; move to a repos.ai_policy column once the DB is configured everywhere.
const cache = new Map<string, { policy: RepoAiReading; expiresAt: number }>();

/** The policy, read at most once per AI_POLICY_TTL_MS per repository. */
export async function repoAiPolicy(client: GitHubClient, repo: string, now = Date.now()): Promise<RepoAiReading> {
  const key = splitRepo(repo).join("/").toLowerCase();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.policy;
  const policy = await fetchAiPolicy(client, repo);
  if (cache.size >= 2_000) cache.clear();
  cache.set(key, { policy, expiresAt: now + AI_POLICY_TTL_MS });
  return policy;
}

/** For tests. */
export function clearAiPolicyCache(): void {
  cache.clear();
}

/** The refusal for a banned policy, quoting it; null otherwise. Same wording as contrib-guard's aiBanReason. */
export function aiPolicyBanReason(policy: RepoAiPolicy): string | null {
  if (policy.stance !== "banned") return null;
  return `this project does not accept AI-generated contributions (${policy.source}: "${policy.evidence}")`;
}
