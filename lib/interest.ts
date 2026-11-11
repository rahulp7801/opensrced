// Early-access requests: the public /join form, and the admin page that grants access.
//
// Requests live in Postgres (access_requests). Approving a request admits that GitHub
// account (by its numeric id, like OPENSRCER_INVITED_GITHUB_IDS; see lib/access.ts) without
// a redeploy. The list operations are pure, so they are tested without storage; the
// storage functions apply them to the table under a lock.
//
// They used to live in one Blob JSON file (INTEREST_PATH). Blob's monthly operations quota
// ran out in production, so the list moved; the old file is imported once (importBlobList).

import { asc, eq, inArray, sql } from "drizzle-orm";
import { readJson } from "./blob-store";
import { getDb, type Db } from "./db/client";
import { accessRequests, appMeta } from "./db/schema";
import { INTEREST_ROLES, type InterestRole } from "./interest-roles";

/** The old Blob file, read only by the one-time import. */
export const INTEREST_PATH = "access/interest.json";
/** More requests than this and the form says sign-ups are full (keeps the list reviewable). */
export const MAX_REQUESTS = 5000;

export type InterestStatus = "new" | "approved" | "declined";
export const INTEREST_STATUSES: readonly InterestStatus[] = ["new", "approved", "declined"];
export { INTEREST_ROLES, type InterestRole } from "./interest-roles";

export type InterestRequest = {
  id: string;
  name: string;
  email: string;
  /** GitHub login as typed (normalized); the id is what grants access. */
  github: string;
  /** Numeric GitHub account id, or null when GitHub couldn't be asked at sign-up. */
  githubId: number | null;
  status: InterestStatus;
  /** Absent on requests made before the form asked. */
  role?: InterestRole;
  createdAt: string;
  updatedAt: string;
};

/** A field the visitor got wrong, with a message to show beside it. */
export class InterestInputError extends Error {
  constructor(readonly field: "name" | "email" | "github" | "role", message: string) {
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
/** A request from the old Blob list that can't be imported as it is. */
export class StoredRequestError extends Error {
  constructor(reason: string) {
    super(`Invalid stored request: ${reason}`);
    this.name = "StoredRequestError";
  }
}

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The form's fields, cleaned and checked. Accepts "@login" and GitHub profile URLs. The role
 *  is optional here (older clients don't send it), but must be one of INTEREST_ROLES when sent. */
export function normalizeInterest(input: { name?: unknown; email?: unknown; github?: unknown; role?: unknown }): { name: string; email: string; github: string; role?: InterestRole } {
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  if (!name) throw new InterestInputError("name", "Please enter your name.");
  if (name.length > 100) throw new InterestInputError("name", "That name is too long (100 characters at most).");

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new InterestInputError("email", "Please enter a valid email address.");

  const raw = typeof input.github === "string" ? input.github.trim() : "";
  const github = raw.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "");
  if (!GITHUB_LOGIN.test(github)) throw new InterestInputError("github", "Please enter your GitHub username, like octocat.");
  if (input.role === undefined) return { name, email, github };
  const role = INTEREST_ROLES.find((r) => r === input.role);
  if (!role) throw new InterestInputError("role", "Please choose your role.");
  return { name, email, github, role };
}

/** Adds a request; one with the same email or GitHub login is not added twice. A
 *  re-submission never changes who a request belongs to (name, email, GitHub login,
 *  status): otherwise anyone could submit their own GitHub login with someone else's
 *  email and have the admin approve the wrong account. It only refreshes the time, and
 *  fills in a GitHub id GitHub couldn't give earlier when the login is the same. */
export function upsertRequest(
  list: InterestRequest[],
  fields: { name: string; email: string; github: string; githubId: number | null; role?: InterestRole },
  now: string,
  newId: string,
): InterestRequest[] {
  const same = (r: InterestRequest) => r.email === fields.email || r.github.toLowerCase() === fields.github.toLowerCase();
  const existing = list.find(same);
  if (existing) {
    const sameLogin = existing.github.toLowerCase() === fields.github.toLowerCase();
    return list.map((r) => (r === existing ? { ...r, githubId: r.githubId ?? (sameLogin ? fields.githubId : null), updatedAt: now } : r));
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

/** The GitHub ids that approval has admitted, as strings (lib/access.ts compares strings). */
export function approvedIdsFrom(list: InterestRequest[]): Set<string> {
  return new Set(list.filter((r) => r.status === "approved" && r.githubId !== null).map((r) => String(r.githubId)));
}

/** Comma-separated values for a spreadsheet; fields that start like a formula are quoted with a leading '. */
export function requestsCsv(list: InterestRequest[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = list.map((r) => [r.name, r.email, r.github, r.githubId === null ? "" : String(r.githubId), r.status, r.createdAt, r.role ?? ""].map(cell).join(","));
  return ["name,email,github,github_id,status,requested_at,role", ...rows].join("\n") + "\n";
}

/** A time stored as text, checked and written the way toISOString writes it. */
function storedTime(value: unknown, field: string): string {
  const time = typeof value === "string" ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime())) throw new StoredRequestError(`${field} is not a time`);
  return time.toISOString();
}

/** One request from the old Blob list, checked field by field with the form's own rules
 *  before it may be imported. Throws StoredRequestError saying what's wrong. */
export function storedRequest(raw: unknown): InterestRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StoredRequestError("not an object");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim() || r.id.length > 100) throw new StoredRequestError("id missing or too long");
  let fields: ReturnType<typeof normalizeInterest>;
  try {
    fields = normalizeInterest(r);
  } catch (error) {
    if (error instanceof InterestInputError) throw new StoredRequestError(`bad ${error.field}`);
    throw error;
  }
  const status = INTEREST_STATUSES.find((s) => s === r.status);
  if (!status) throw new StoredRequestError("unknown status");
  // Absent is treated as unknown (null), the same as a lookup that failed at sign-up.
  const githubId = r.githubId ?? null;
  if (githubId !== null && !(typeof githubId === "number" && Number.isSafeInteger(githubId) && githubId > 0)) throw new StoredRequestError("bad githubId");
  return { id: r.id, ...fields, githubId, status, createdAt: storedTime(r.createdAt, "createdAt"), updatedAt: storedTime(r.updatedAt, "updatedAt") };
}

/** Folds requests from the old Blob list into the current list. A request new to the list
 *  is added as it was, past MAX_REQUESTS too (an import never drops anyone). One that
 *  matches a request already here (by id, email or GitHub login) merges only when it is the
 *  same person, same email and same login: the Blob decision counts unless an admin has
 *  decided here since, a missing GitHub id is filled in, and the earlier request time kept.
 *  A match with someone else is returned as a conflict for an admin, never merged, so an
 *  import can't hand an approval to another account (the rule upsertRequest keeps). */
export function mergeImported(list: InterestRequest[], incoming: InterestRequest[]): { list: InterestRequest[]; conflicts: InterestRequest[] } {
  let next = list;
  const conflicts: InterestRequest[] = [];
  for (const b of incoming) {
    const login = b.github.toLowerCase();
    const match = next.find((r) => r.id === b.id || r.email === b.email || r.github.toLowerCase() === login);
    if (!match) {
      next = [...next, b];
      continue;
    }
    if (match.email !== b.email || match.github.toLowerCase() !== login) {
      conflicts.push(b);
      continue;
    }
    const merged: InterestRequest = {
      ...match,
      status: match.status === "new" ? b.status : match.status,
      githubId: match.githubId ?? b.githubId,
      createdAt: b.createdAt < match.createdAt ? b.createdAt : match.createdAt,
      updatedAt: b.updatedAt > match.updatedAt ? b.updatedAt : match.updatedAt,
    };
    const role = match.role ?? b.role;
    if (role) merged.role = role;
    next = next.map((r) => (r === match ? merged : r));
  }
  return { list: next, conflicts };
}

// ── Storage ────────────────────────────────────────────────────────────────

/** Reads the old Blob list: its parsed JSON, or null when there is no such file. */
export type BlobListReader = () => Promise<unknown>;

/** What the storage functions talk to. The app passes nothing (its database, the real
 *  Blob file, the real clock); tests pass a PGlite database, a fake reader and a clock. */
export type InterestStore = { getDb?: () => Promise<Db>; readBlobList?: BlobListReader; now?: () => number };

async function readOldBlobList(): Promise<unknown> {
  return (await readJson<unknown>(INTEREST_PATH, 4_000_000))?.value ?? null;
}

type Row = typeof accessRequests.$inferSelect;

function toRow(r: InterestRequest): Row {
  return {
    id: r.id, name: r.name, email: r.email, github: r.github, githubId: r.githubId, status: r.status,
    role: r.role ?? null, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
  };
}

function fromRow(row: Row): InterestRequest {
  const request: InterestRequest = {
    id: row.id, name: row.name, email: row.email, github: row.github, githubId: row.githubId, status: row.status,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
  if (row.role) request.role = row.role;
  return request;
}

/** Oldest first, the order the Blob list kept (so upsertRequest's first match is the same). */
async function readAll(db: Db): Promise<InterestRequest[]> {
  return (await db.select().from(accessRequests).orderBy(asc(accessRequests.createdAt), asc(accessRequests.id))).map(fromRow);
}

/** Taken at the start of every write transaction: writers run one at a time (each reads
 *  the whole list, applies a pure change and writes the difference), while plain reads,
 *  like the access check, go on. Released when the transaction ends. */
async function lockRequests(tx: Db): Promise<void> {
  await tx.execute(sql`LOCK TABLE access_requests IN SHARE ROW EXCLUSIVE MODE`);
}

/** Writes the difference between two versions of the list: deletes first, so a removed
 *  request's email or login can be taken again, then updates, then inserts in batches. */
async function writeChanges(tx: Db, before: InterestRequest[], after: InterestRequest[]): Promise<void> {
  const old = new Map(before.map((r) => [r.id, r]));
  const kept = new Set(after.map((r) => r.id));
  const gone = before.filter((r) => !kept.has(r.id)).map((r) => r.id);
  if (gone.length) await tx.delete(accessRequests).where(inArray(accessRequests.id, gone));
  const same = (a: InterestRequest, b: InterestRequest) => JSON.stringify(toRow(a)) === JSON.stringify(toRow(b));
  const added: Row[] = [];
  for (const r of after) {
    const prev = old.get(r.id);
    if (!prev) added.push(toRow(r));
    else if (!same(prev, r)) await tx.update(accessRequests).set(toRow(r)).where(eq(accessRequests.id, r.id));
  }
  for (let i = 0; i < added.length; i += 500) await tx.insert(accessRequests).values(added.slice(i, i + 500));
}

// ── One-time import of the old Blob list ──────────────────────────────────

const BLOB_IMPORT_KEY = "interest-blob-import";
/** After a failed Blob read, how long an instance waits before trying again. */
export const BLOB_IMPORT_RETRY_MS = 5 * 60_000;

// Per database (tests open several), so an instance asks Postgres whether the import is
// done once, and a failing Blob is asked at most every BLOB_IMPORT_RETRY_MS.
type ImportState = { done: boolean; failedAt?: number; pending?: Promise<void> };
const importStates = new WeakMap<Db, ImportState>();

async function importRecorded(db: Db): Promise<boolean> {
  return (await db.select({ key: appMeta.key }).from(appMeta).where(eq(appMeta.key, BLOB_IMPORT_KEY)).limit(1)).length > 0;
}

/** Imports the old Blob list into Postgres once, unless that's already recorded. Never
 *  throws over Blob: a failed read is logged and retried later, and Postgres serves
 *  requests meanwhile. A Postgres error is thrown, as any read of the list would. */
async function ensureBlobImported(db: Db, read: BlobListReader, now: number): Promise<void> {
  let state = importStates.get(db);
  if (!state) importStates.set(db, (state = { done: false }));
  if (state.done) return;
  if (state.pending) return state.pending; // one import attempt at a time per instance
  if (state.failedAt !== undefined && now - state.failedAt < BLOB_IMPORT_RETRY_MS) return;
  const attempt = importBlobList(db, read, state, now);
  state.pending = attempt;
  try {
    await attempt;
  } finally {
    state.pending = undefined;
  }
}

async function importBlobList(db: Db, read: BlobListReader, state: ImportState, now: number): Promise<void> {
  if (await importRecorded(db)) {
    state.done = true;
    return;
  }
  let raw: unknown;
  try {
    raw = await read();
  } catch (error) {
    // Any failure to read Blob (quota exhausted, store not configured, network) is this
    // case: the import waits, the waitlist itself must not. Non-errors are not expected.
    if (!(error instanceof Error)) throw error;
    state.failedAt = now;
    console.error(`[interest] could not read the old Blob list of requests; serving Postgres only, retrying in ${BLOB_IMPORT_RETRY_MS / 60_000} min`, error);
    return;
  }
  if (raw !== null && !Array.isArray(raw)) {
    // A damaged file is not "nothing to import": keep it unimported and keep saying so.
    state.failedAt = now;
    console.error("[interest] the old Blob list of requests is not a list; not importing it, retrying later");
    return;
  }
  const rows = raw ?? [];
  const valid: InterestRequest[] = [];
  const reasons = new Map<string, number>();
  for (const item of rows) {
    try {
      valid.push(storedRequest(item));
    } catch (error) {
      if (!(error instanceof StoredRequestError)) throw error;
      reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1);
    }
  }
  const invalid = rows.length - valid.length;
  const conflicts = await db.transaction(async (tx) => {
    await lockRequests(tx);
    if (await importRecorded(tx)) return null; // another instance got there first
    const before = await readAll(tx);
    const merged = mergeImported(before, valid);
    await writeChanges(tx, before, merged.list);
    await tx.insert(appMeta).values({
      key: BLOB_IMPORT_KEY,
      value: { importedAt: new Date(now).toISOString(), found: rows.length, invalid, conflicts: merged.conflicts },
    });
    return merged.conflicts;
  });
  state.done = true;
  clearApprovedCache();
  if (!conflicts) return;
  if (raw === null) console.warn("[interest] no old Blob list of requests found; nothing to import");
  else console.log(`[interest] imported the old Blob list of requests: ${rows.length} found, ${valid.length - conflicts.length} imported or merged`);
  if (invalid) console.error(`[interest] skipped ${invalid} invalid request(s) from the old Blob list`, Object.fromEntries(reasons));
  if (conflicts.length) console.error(`[interest] ${conflicts.length} request(s) from the old Blob list match someone else's email or login here; kept in app_meta "${BLOB_IMPORT_KEY}" for an admin`, conflicts.map((c) => `${c.email} @${c.github}`));
}

// ── The list ───────────────────────────────────────────────────────────────

/** Every request, oldest first. */
export async function listRequests(store: InterestStore = {}): Promise<InterestRequest[]> {
  const db = await (store.getDb ?? getDb)();
  await ensureBlobImported(db, store.readBlobList ?? readOldBlobList, (store.now ?? Date.now)());
  return readAll(db);
}

/** Applies a pure change (upsertRequest, setRequestStatus, removeRequest) to the list in
 *  one transaction, with writers locked out meanwhile, so two at once can't lose either
 *  write. Whatever `change` throws (InterestNotFoundError, InterestFullError) rolls it back. */
export async function updateRequests(change: (list: InterestRequest[]) => InterestRequest[], store: InterestStore = {}): Promise<void> {
  const db = await (store.getDb ?? getDb)();
  await ensureBlobImported(db, store.readBlobList ?? readOldBlobList, (store.now ?? Date.now)());
  await db.transaction(async (tx) => {
    await lockRequests(tx);
    const before = await readAll(tx);
    await writeChanges(tx, before, change(before));
  });
  clearApprovedCache();
}

// Approved ids, read at most every 30 seconds per server instance: the access check
// runs on every request, and a new approval may take that long to reach every instance.
const APPROVED_TTL_MS = 30_000;
let approvedCache: { at: number; ids: Set<string> } | null = null;

/** Drops the cached approved ids: after a write on this instance, and between tests. */
export function clearApprovedCache(): void {
  approvedCache = null;
}

/** The GitHub ids admitted by approval. Fails closed: if storage can't be read, nobody
 *  is admitted this way (the OPENSRCER_INVITED_GITHUB_IDS list still works). */
export async function approvedGithubIds(store: InterestStore = {}): Promise<Set<string>> {
  if (approvedCache && Date.now() - approvedCache.at < APPROVED_TTL_MS) return approvedCache.ids;
  try {
    approvedCache = { at: Date.now(), ids: approvedIdsFrom(await listRequests(store)) };
  } catch (error) {
    console.error("[access] could not read approved requests; only the invited list applies", error);
    approvedCache = { at: Date.now(), ids: new Set() };
  }
  return approvedCache.ids;
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
