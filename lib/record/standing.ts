// Standing points and the level they imply (PLAN §9.3). standing_events is
// append-only: events are inserted, never updated or deleted, and the same
// (user, kind, ref) counts once. users.level and users.standing are a cache
// that rebuildStanding rewrites from the events, so both can always be
// rebuilt and audited. No leaderboards: nothing here ranks users.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { splitRepo } from "../ai-policy";
import { getDb, type Db } from "../db/client";
import { contributions, repos, standingEvents, users } from "../db/schema";
import { flagEnabled } from "../flags";
import type { Lesson } from "../lesson/store";
import { ensureUser as upsertUser } from "../users";
import { emptyStats, levelIndex, LEVELS, qualifiedLevel, type Level, type LevelStats } from "./levels";

/** Points per event. Opening a PR earns 0; a PR closed without a merge costs 0. */
export const POINTS = {
  merged: 100,
  /** Path B: the contributor wrote the fix themselves. */
  pathBMultiplier: 1.5,
  /** The second or later merged PR in the same repository. */
  continuityMultiplier: 1.5,
  approval: 30,
  /** Replied to the review, then merged. */
  reviewReplied: 20,
  /** A lesson finished without a level-3 hint. */
  cleanLesson: 15,
  briefReview: 10,
  /** Imported (outside) merged PRs count at this weight. */
  importedWeight: 0.5,
} as const;

export const STANDING_KINDS = [
  "merged", "merged_self", "imported_merged", "approval", "review_replied", "review_unanswered",
  "lesson_clean", "brief_review", "spam_flag", "spam_cleared",
] as const;
export type StandingKind = (typeof STANDING_KINDS)[number];
/** `ref` names what earned it: "owner/name#123", a lesson id, or a flag's reason. */
export type StandingEvent = { kind: StandingKind; ref: string; points: number };

export class UnknownUserError extends Error {
  constructor(userId: string) {
    super(`No user ${JSON.stringify(userId.slice(0, 100))}`);
    this.name = "UnknownUserError";
  }
}

export class InvalidStandingEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStandingEventError";
  }
}

export class UnknownSpamFlagError extends Error {
  constructor(ref: string) {
    super(`No open spam flag ${JSON.stringify(ref.slice(0, 100))}`);
    this.name = "UnknownSpamFlagError";
  }
}

/** A merged PR's points: path B and continuity multiply. Pure. */
export function mergedPoints(pathB: boolean, earlierMergedInRepo: number): number {
  return Math.round(POINTS.merged * (pathB ? POINTS.pathBMultiplier : 1) * (earlierMergedInRepo > 0 ? POINTS.continuityMultiplier : 1));
}

export const importedPoints = () => Math.round(POINTS.merged * POINTS.importedWeight);

/** "owner/name#123" → "owner/name" (lower case), or null. */
export function repoOfRef(ref: string): string | null {
  const m = /^([^/#\s]+\/[^/#\s]+)#\d+$/.exec(ref);
  return m ? m[1].toLowerCase() : null;
}

/** `flags`: the open spam flags' refs. */
export type Replayed = { standing: number; level: Level; stats: LevelStats; breakdown: Partial<Record<StandingKind, number>>; flags: string[] };

/** Replay events oldest first. Standing is the sum of points. The level only
 *  ever rises, and not while a spam flag is open. Pure. */
export function replay(events: Array<{ kind: string; ref: string | null; points: number }>): Replayed {
  const stats = emptyStats();
  const flags = new Set<string>();
  const breakdown: Partial<Record<StandingKind, number>> = {};
  let standing = 0;
  let level: Level = "newcomer";
  for (const e of events) {
    if (!isKind(e.kind)) continue;
    standing += e.points;
    breakdown[e.kind] = (breakdown[e.kind] ?? 0) + e.points;
    const ref = e.ref ?? "";
    if (e.kind === "merged" || e.kind === "merged_self") {
      const repo = repoOfRef(ref);
      if (repo) stats.mergedByRepo[repo] = (stats.mergedByRepo[repo] ?? 0) + 1;
      if (e.kind === "merged_self") stats.pathB++;
    } else if (e.kind === "imported_merged") stats.importedMerged++;
    else if (e.kind === "approval") stats.approvals++;
    else if (e.kind === "review_unanswered") stats.unansweredReviews++;
    else if (e.kind === "brief_review") stats.briefReviews++;
    else if (e.kind === "spam_flag") flags.add(ref);
    else if (e.kind === "spam_cleared") flags.delete(ref);
    stats.spamFlagged = flags.size > 0;
    if (stats.spamFlagged) continue;
    const qualified = qualifiedLevel(stats);
    if (levelIndex(qualified) > levelIndex(level)) level = qualified;
  }
  return { standing, level, stats, breakdown, flags: [...flags] };
}

function isKind(kind: string): kind is StandingKind {
  return (STANDING_KINDS as readonly string[]).includes(kind);
}

function validateEvent(e: StandingEvent): void {
  if (!isKind(e.kind)) throw new InvalidStandingEventError(`Unknown standing event kind: ${String(e.kind)}`);
  if (typeof e.ref !== "string" || !e.ref.trim() || e.ref.length > 300) throw new InvalidStandingEventError("A standing event needs a ref of 1-300 characters.");
  // No negative points: nothing here is a penalty.
  if (!Number.isSafeInteger(e.points) || e.points < 0) throw new InvalidStandingEventError(`Points must be a whole number of at least 0 (got ${e.points}).`);
}

export async function assertUser(db: Db, userId: string): Promise<void> {
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!found) throw new UnknownUserError(userId);
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export class InvalidLoginError extends Error {
  constructor(login: string) {
    super(`Not a GitHub login: ${JSON.stringify(login.slice(0, 50))}`);
    this.name = "InvalidLoginError";
  }
}

export function assertLogin(login: string): void {
  if (typeof login !== "string" || !LOGIN_RE.test(login)) throw new InvalidLoginError(String(login));
}

/** lib/users.ts ensureUser, with the login checked as a GitHub login first
 *  (the record searches GitHub by it). */
export async function ensureUser(db: Db, id: string, login: string): Promise<void> {
  assertLogin(login);
  await upsertUser(db, id, login);
}

/** The repository's id, matched case-insensitively (GitHub is), created when new. */
export async function ensureRepo(db: Db, repoFull: string): Promise<number> {
  const [owner, name] = splitRepo(repoFull);
  const same = and(eq(sql`lower(${repos.owner})`, owner.toLowerCase()), eq(sql`lower(${repos.name})`, name.toLowerCase()));
  const [found] = await db.select({ id: repos.id }).from(repos).where(same).limit(1);
  if (found) return found.id;
  // A concurrent insert of the same spelling wins the unique key; read it back.
  const [row] = await db.insert(repos).values({ owner, name }).onConflictDoNothing().returning({ id: repos.id });
  return row?.id ?? (await db.select({ id: repos.id }).from(repos).where(same).limit(1))[0].id;
}

/** Append events; one already recorded (same user, kind and ref) is skipped.
 *  Validates everything before writing anything. Returns how many were new. */
export async function appendEvents(db: Db, userId: string, events: StandingEvent[]): Promise<number> {
  events.forEach(validateEvent);
  await assertUser(db, userId);
  if (!events.length) return 0;
  const inserted = await db.insert(standingEvents).values(events.map((e) => ({ userId, kind: e.kind, ref: e.ref, points: e.points })))
    .onConflictDoNothing().returning({ id: standingEvents.id });
  return inserted.length;
}

async function eventsOf(db: Db, userId: string) {
  return db.select({ kind: standingEvents.kind, ref: standingEvents.ref, points: standingEvents.points })
    .from(standingEvents).where(eq(standingEvents.userId, userId)).orderBy(asc(standingEvents.at), asc(standingEvents.id));
}

/** Recompute standing and level from the events and cache them on users. */
export async function rebuildStanding(db: Db, userId: string): Promise<Replayed> {
  await assertUser(db, userId);
  const result = replay(await eventsOf(db, userId));
  await db.update(users).set({ level: levelIndex(result.level), standing: result.standing }).where(eq(users.id, userId));
  return result;
}

/** Close a spam flag after review: appends spam_cleared for its ref. */
export async function clearSpamFlag(db: Db, userId: string, flagRef: string): Promise<Replayed> {
  await assertUser(db, userId);
  const events = await eventsOf(db, userId);
  const open = events.some((e) => e.kind === "spam_flag" && e.ref === flagRef) && !events.some((e) => e.kind === "spam_cleared" && e.ref === flagRef);
  if (!open) throw new UnknownSpamFlagError(flagRef);
  await appendEvents(db, userId, [{ kind: "spam_cleared", ref: flagRef, points: 0 }]);
  return rebuildStanding(db, userId);
}

/** A finished lesson earns cleanLesson points when no level-3 hint was used.
 *  A lesson given up (revealed early) earns none. Null when it earns nothing. Pure. */
export function lessonCleanEvent(lesson: Pick<Lesson, "id" | "stage" | "gave_up" | "steps">): StandingEvent | null {
  if (lesson.stage !== "done" || lesson.gave_up) return null;
  if (Object.values(lesson.steps).some((s) => (s?.hint_level ?? -1) >= 3)) return null;
  return { kind: "lesson_clean", ref: lesson.id, points: POINTS.cleanLesson };
}

/** Record a finished lesson (lib/lesson/api.ts calls this through LessonDeps.finished). */
export async function recordLessonFinished(db: Db, userId: string, login: string, lesson: Lesson): Promise<void> {
  const event = lessonCleanEvent(lesson);
  if (!event) return;
  await ensureUser(db, userId, login);
  if (await appendEvents(db, userId, [event])) await rebuildStanding(db, userId);
}

/** The level PR caps use: newcomer while a spam flag is open, and for a user with no record yet. */
export async function capsLevel(db: Db, userId: string): Promise<Level> {
  const { level, stats } = replay(await eventsOf(db, userId));
  return stats.spamFlagged ? "newcomer" : level;
}

/** capsLevel behind OPENSRCER_RECORD; newcomer (today's caps) while it is off. */
export async function capsLevelFor(userId: string): Promise<Level> {
  return flagEnabled("record") ? capsLevel(await getDb(), userId) : "newcomer";
}

/** What the user sees of their own record (never anyone else's). */
export async function recordView(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new UnknownUserError(userId);
  const replayed = replay(await eventsOf(db, userId));
  const prs = await db.select({
    repo: repos.owner, name: repos.name, number: contributions.prNumber, state: contributions.state, source: contributions.source,
    path: contributions.path, openedAt: contributions.openedAt, mergedAt: contributions.mergedAt, reviewRounds: contributions.reviewRounds,
    approvedByMaintainer: contributions.approvedByMaintainer, respondedToReview: contributions.respondedToReview,
  }).from(contributions).innerJoin(repos, eq(repos.id, contributions.repoId))
    .where(eq(contributions.userId, userId)).orderBy(desc(contributions.openedAt)).limit(200);
  return {
    login: user.login,
    level: replayed.level,
    levels: LEVELS,
    standing: replayed.standing,
    breakdown: replayed.breakdown,
    // Private to the user: why level-ups are frozen, if they are.
    spamFlags: replayed.flags,
    contributions: prs.map(({ repo, name, ...pr }) => ({ repo: `${repo}/${name}`, ...pr })),
    history: (user.settings as { history?: unknown }).history ?? null,
  };
}
