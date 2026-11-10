// The installable harness (harness/ in this repository: a Claude Code plugin)
// talks to opensrcer with a personal token instead of a browser session.
//
// Tokens are shown once and stored only as SHA-256 hashes. Every harness
// request checks the token AND the account's access (the invite allowlist),
// so a token can never reach more than its signed-in owner could: revoking
// someone's invite revokes their harness too.

import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { apiTokens, harnessEvents, lessons } from "./db/schema";
import { ensureUser } from "./users";
import { splitRepo } from "./ai-policy";

import { TOKEN_HEADER, TOKEN_PREFIX } from "./harness-token";

export { TOKEN_HEADER, TOKEN_PREFIX };
export const MAX_TOKENS = 10;
export const MAX_EVENT_BYTES = 4_000;

export const EVENT_TYPES = ["session_start", "profile_viewed", "verification", "pr_opened", "pr_merged", "pr_closed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export class HarnessAuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "HarnessAuthError";
  }
}
export class TokenLimitError extends Error {
  constructor() {
    super(`You already have ${MAX_TOKENS} harness tokens. Revoke one first.`);
    this.name = "TokenLimitError";
  }
}
export class TokenNotFoundError extends Error {
  constructor() {
    super("No such token.");
    this.name = "TokenNotFoundError";
  }
}
export class HarnessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessInputError";
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type TokenInfo = { id: number; name: string; createdAt: Date; lastUsedAt: Date | null };

/** A new token for the user; the plaintext is returned once and never stored. */
export async function createToken(db: Db, userId: string, login: string, name: string): Promise<TokenInfo & { token: string }> {
  const label = name.trim().slice(0, 60);
  if (!label) throw new HarnessInputError("Give the token a name, such as the machine it is for.");
  await ensureUser(db, userId, login);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if (count >= MAX_TOKENS) throw new TokenLimitError();
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const [row] = await db.insert(apiTokens).values({ userId, name: label, hash: hashToken(token) })
    .returning({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt });
  return { ...row, token };
}

/** The user's live tokens, newest first; never their hashes. */
export async function listTokens(db: Db, userId: string): Promise<TokenInfo[]> {
  return db.select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens).where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.id));
}

/** Revoke one of the user's own tokens. Throws TokenNotFoundError for anyone else's. */
export async function revokeToken(db: Db, userId: string, id: number, now = new Date()): Promise<void> {
  const rows = await db.update(apiTokens).set({ revokedAt: now })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!rows.length) throw new TokenNotFoundError();
}

/** The user behind a harness request. Every /api/harness route calls this
 *  first (lib/__tests__/harness.test.ts checks). `canUse` is the invite check. */
export async function harnessUser(
  db: Db, authorization: string | null, canUse: (sub: string) => Promise<boolean>, now = new Date(),
): Promise<string> {
  if (!authorization || !TOKEN_HEADER.test(authorization)) throw new HarnessAuthError(401, "Missing or malformed harness token.");
  const [row] = await db.select({ id: apiTokens.id, userId: apiTokens.userId }).from(apiTokens)
    .where(and(eq(apiTokens.hash, hashToken(authorization.slice("Bearer ".length))), isNull(apiTokens.revokedAt))).limit(1);
  if (!row) throw new HarnessAuthError(401, "This harness token is not valid. Create a new one on your Account page.");
  if (!await canUse(row.userId)) throw new HarnessAuthError(403, "opensrcer is invite-only and this account is not invited.");
  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id));
  return row.userId;
}

/** Store one harness event. Throws HarnessInputError on anything malformed. */
export async function recordEvent(db: Db, userId: string, input: unknown): Promise<void> {
  const e = (input ?? {}) as { type?: unknown; repo?: unknown; data?: unknown };
  if (typeof e.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(e.type)) {
    throw new HarnessInputError(`type must be one of: ${EVENT_TYPES.join(", ")}.`);
  }
  let repo: string;
  try { repo = splitRepo(String(e.repo ?? "")).join("/"); } catch { throw new HarnessInputError("repo must be owner/name."); }
  const data = e.data === undefined ? {} : e.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HarnessInputError("data must be an object.");
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_EVENT_BYTES) throw new HarnessInputError(`data must be under ${MAX_EVENT_BYTES} bytes.`);
  await db.insert(harnessEvents).values({ userId, repo, type: e.type, data: data as Record<string, unknown> });
}

// ── Daily limits per account ─────────────────────────────────────────────
// What a harness user can spend of the site's compute and storage in a
// rolling 24 hours: lessons (each stores its issue, README and code graph)
// and code maps built in the graph sandbox (a map served from the shared
// store is free). Counted from rows the site writes anyway, so no counter
// table. Tune with the environment variables below.

export const DAILY_LIMITS = {
  lessons: { env: "OPENSRCER_HARNESS_LESSONS_PER_DAY", fallback: 20, one: "lesson", many: "lessons" },
  graph_builds: { env: "OPENSRCER_HARNESS_GRAPH_BUILDS_PER_DAY", fallback: 5, one: "new code map", many: "new code maps" },
} as const;
export type DailyKind = keyof typeof DAILY_LIMITS;
/** Written by the site alone (not in EVENT_TYPES, so a client can't post it). */
export const GRAPH_BUILT = "graph_built";
const DAY_MS = 24 * 60 * 60_000;

export class DailyLimitError extends Error {
  readonly status = 429;
}
/** A limit variable that is set but isn't a whole number of at least 1. */
export class DailyLimitConfigError extends Error {}

/** The account's limit for `kind`: its environment variable, else the default. */
export function dailyLimit(kind: DailyKind, env: Record<string, string | undefined> = process.env): number {
  const { env: name, fallback } = DAILY_LIMITS[kind];
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  // A typo must not lift the limit or close the harness quietly: refuse it loudly.
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new DailyLimitConfigError(`${name} must be a whole number of at least 1, not "${raw}".`);
  return Number(raw);
}

/** How many of `kind` the account used in the 24 hours before `now`. */
export async function dailyUsage(db: Db, userId: string, kind: DailyKind, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = kind === "lessons"
    ? await db.select({ n: count() }).from(lessons).where(and(eq(lessons.userId, userId), gte(lessons.startedAt, since)))
    : await db.select({ n: count() }).from(harnessEvents).where(and(eq(harnessEvents.userId, userId), eq(harnessEvents.type, GRAPH_BUILT), gte(harnessEvents.at, since)));
  return Number(row?.n ?? 0);
}

/** Throws DailyLimitError when the account has used its limit for `kind`. */
export async function assertUnderDailyLimit(db: Db, userId: string, kind: DailyKind, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<void> {
  const limit = dailyLimit(kind, env);
  if (await dailyUsage(db, userId, kind, now) >= limit) {
    const { one, many } = DAILY_LIMITS[kind];
    throw new DailyLimitError(`You've started ${limit} ${limit === 1 ? one : many} in the last 24 hours, the most an account can for now. Try again later.`);
  }
}

/** Counts a code map built for this account (lib/harness.ts graph_builds). */
export async function recordGraphBuild(db: Db, userId: string, repo: string): Promise<void> {
  await db.insert(harnessEvents).values({ userId, repo: splitRepo(repo).join("/"), type: GRAPH_BUILT, data: {} });
}
