// Early-access requests: the public /join form, and the admin page that grants access.
//
// Requests live in one private JSON blob. Approving a request admits that GitHub account
// (by its numeric id, like OPENSRCER_INVITED_GITHUB_IDS; see lib/access.ts) without a
// redeploy. The list operations are pure, so they are tested without storage.

import { readJson, updateJson } from "./blob-store";
import { parseRunTarget } from "./run-target";

export const INTEREST_PATH = "access/interest.json";
/** More requests than this and the form says sign-ups are full (keeps the blob small). */
export const MAX_REQUESTS = 5000;

export type InterestStatus = "new" | "approved" | "declined";
export const INTEREST_STATUSES: readonly InterestStatus[] = ["new", "approved", "declined"];
/** A maintainer's request (/join?maintainer): keep opensrcer off their repository, or try it on it. */
export type MaintainerIntent = "opt-out" | "try";

export type InterestRequest = {
  id: string;
  name: string;
  email: string;
  /** GitHub login as typed (normalized); the id is what grants access. */
  github: string;
  /** Numeric GitHub account id, or null when GitHub couldn't be asked at sign-up. */
  githubId: number | null;
  status: InterestStatus;
  /** Maintainers only: their repository ("owner/name") and what they want for it. */
  repo?: string;
  intent?: MaintainerIntent;
  createdAt: string;
  updatedAt: string;
};

/** A field the visitor got wrong, with a message to show beside it. */
export class InterestInputError extends Error {
  constructor(readonly field: "name" | "email" | "github" | "repo" | "intent", message: string) {
    super(message);
    this.name = "InterestInputError";
  }
}
export class InterestNotFoundError extends Error {
  constructor(id: string) {
    super(`No access request with id ${id}`);
    this.name = "InterestNotFoundError";
  }
}
export class InterestFullError extends Error {
  constructor() {
    super("Sign-ups are full for now.");
    this.name = "InterestFullError";
  }
}

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The form's three fields, cleaned and checked. Accepts "@login" and GitHub profile URLs.
 *  A maintainer's form adds the repository and what they want for it. */
export function normalizeInterest(input: { name?: unknown; email?: unknown; github?: unknown; repo?: unknown; intent?: unknown }): { name: string; email: string; github: string; repo?: string; intent?: MaintainerIntent } {
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  if (!name) throw new InterestInputError("name", "Please enter your name.");
  if (name.length > 100) throw new InterestInputError("name", "That name is too long (100 characters at most).");

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new InterestInputError("email", "Please enter a valid email address.");

  const raw = typeof input.github === "string" ? input.github.trim() : "";
  const github = raw.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "");
  if (!GITHUB_LOGIN.test(github)) throw new InterestInputError("github", "Please enter your GitHub username, like octocat.");
  if (input.repo === undefined && input.intent === undefined) return { name, email, github };

  if (input.intent !== "opt-out" && input.intent !== "try") throw new InterestInputError("intent", "Choose whether to opt your repository out or try it.");
  let repo: string;
  try { repo = parseRunTarget(input.repo).repo; } catch { throw new InterestInputError("repo", "Please enter your repository, like pallets/flask."); }
  return { name, email, github, repo, intent: input.intent };
}

/** Adds a request, or updates the one with the same email or GitHub login (someone
 *  signing up twice shouldn't appear twice). A re-submission keeps the existing status. */
export function upsertRequest(
  list: InterestRequest[],
  fields: { name: string; email: string; github: string; githubId: number | null; repo?: string; intent?: MaintainerIntent },
  now: string,
  newId: string,
): InterestRequest[] {
  const same = (r: InterestRequest) => r.email === fields.email || r.github.toLowerCase() === fields.github.toLowerCase();
  const existing = list.find(same);
  if (existing) {
    return list.map((r) => (r === existing ? { ...r, ...fields, githubId: fields.githubId ?? r.githubId, updatedAt: now } : r));
  }
  if (list.length >= MAX_REQUESTS) throw new InterestFullError();
  return [...list, { id: newId, ...fields, status: "new", createdAt: now, updatedAt: now }];
}

/** Sets a request's status (and its GitHub id, when one was just looked up). */
export function setRequestStatus(list: InterestRequest[], id: string, status: InterestStatus, now: string, githubId?: number): InterestRequest[] {
  if (!INTEREST_STATUSES.includes(status)) throw new RangeError(`Unknown status ${String(status)}`);
  if (!list.some((r) => r.id === id)) throw new InterestNotFoundError(id);
  return list.map((r) => (r.id === id ? { ...r, status, githubId: githubId ?? r.githubId, updatedAt: now } : r));
}

export function removeRequest(list: InterestRequest[], id: string): InterestRequest[] {
  if (!list.some((r) => r.id === id)) throw new InterestNotFoundError(id);
  return list.filter((r) => r.id !== id);
}

/** The GitHub ids that approval has admitted, as strings (lib/access.ts compares strings).
 *  Approving an opt-out keeps opensrcer off a repository; it admits nobody. */
export function approvedIdsFrom(list: InterestRequest[]): Set<string> {
  return new Set(list.filter((r) => r.status === "approved" && r.githubId !== null && r.intent !== "opt-out").map((r) => String(r.githubId)));
}

/** Repositories whose maintainers opted out, once an admin approved it (lowercase "owner/name"). */
export function optedOutFrom(list: InterestRequest[]): Set<string> {
  return new Set(list.filter((r) => r.status === "approved" && r.intent === "opt-out" && r.repo).map((r) => r.repo!.toLowerCase()));
}

/** Comma-separated values for a spreadsheet; fields that start like a formula are quoted with a leading '. */
export function requestsCsv(list: InterestRequest[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = list.map((r) => [r.name, r.email, r.github, r.githubId === null ? "" : String(r.githubId), r.status, r.createdAt].map(cell).join(","));
  return ["name,email,github,github_id,status,requested_at", ...rows].join("\n") + "\n";
}

// ── Storage ────────────────────────────────────────────────────────────────

export async function listRequests(): Promise<InterestRequest[]> {
  return (await readJson<InterestRequest[]>(INTEREST_PATH, 4_000_000))?.value ?? [];
}

export async function updateRequests(change: (list: InterestRequest[]) => InterestRequest[]): Promise<void> {
  await updateJson<InterestRequest[]>(INTEREST_PATH, [], change);
  approvedCache = null;
  optedOutCache = null;
}

// Approved ids, read at most every 30 seconds per server instance: the access check
// runs on every request, and a new approval may take that long to reach every instance.
const APPROVED_TTL_MS = 30_000;
let approvedCache: { at: number; ids: Set<string> } | null = null;

/** The GitHub ids admitted by approval. Fails closed: if storage can't be read, nobody
 *  is admitted this way (the OPENSRCER_INVITED_GITHUB_IDS list still works). */
export async function approvedGithubIds(): Promise<Set<string>> {
  if (approvedCache && Date.now() - approvedCache.at < APPROVED_TTL_MS) return approvedCache.ids;
  try {
    approvedCache = { at: Date.now(), ids: approvedIdsFrom(await listRequests()) };
  } catch (error) {
    console.error("[access] could not read approved requests; only the invited list applies", error);
    approvedCache = { at: Date.now(), ids: new Set() };
  }
  return approvedCache.ids;
}

// Opted-out repositories, read at most every 30 seconds per server instance, like approvals.
let optedOutCache: { at: number; repos: Set<string> } | null = null;

/** Why a run or publish on this repository is refused because its maintainers opted out, or null.
 *  Fails open, logged: an unreadable store must not stop every run (a CONTRIBUTING.md ban
 *  still applies). */
export async function optOutReason(repo: string): Promise<string | null> {
  if (!optedOutCache || Date.now() - optedOutCache.at >= APPROVED_TTL_MS) {
    try {
      optedOutCache = { at: Date.now(), repos: optedOutFrom(await listRequests()) };
    } catch (error) {
      console.error("[opt-out] could not read opted-out repositories", error);
      return null;
    }
  }
  return optedOutCache.repos.has(repo.toLowerCase()) ? "this repository's maintainers opted out of opensrcer" : null;
}

/** The numeric id of a GitHub login, or null when GitHub can't be asked right now.
 *  Throws InterestInputError when GitHub says there is no such account. */
export async function lookupGithubId(login: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "opensrcer", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (res.status === 404) throw new InterestInputError("github", "There's no GitHub account with that username.");
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: unknown; type?: unknown };
    if (user.type === "Organization") throw new InterestInputError("github", "That's an organization; please enter your personal GitHub username.");
    return typeof user.id === "number" ? user.id : null;
  } catch (error) {
    if (error instanceof InterestInputError) throw error;
    return null;
  }
}
