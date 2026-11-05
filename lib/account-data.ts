// Everything opensrcer keeps about one account, for "Export my data" and
// "Delete my data" on /account (app/api/me).
//
//   Database   the users row, settings included (onboarding answers,
//              imported history, home project, next-in-area card); lessons
//              (and their steps and messages), contributions, map_coverage,
//              standing_events and alerts all reference it and go with it
//              (ON DELETE CASCADE).
//   Blob       users/<sha256(id)>/ (runs, summaries, graphs, lifecycle,
//              fork CI) and stats/<sha256(id)>.json, when hosted.
//   Local      .dispatches/<id>.{json,log} and .dispatches/<id>/ for the
//              account's runs, and .dispatches/stats/<sha256(id)>.json.
//
// Every path is derived from the account id with the same helpers the
// writers use, and checked against those prefixes again before a delete, so
// a listing that returned something unexpected can never remove another
// account's records.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { alerts, apiTokens, contributions, harnessEvents, lessonMessages, lessonSteps, lessons, mapCoverage, standingEvents, users } from "./db/schema";
import { ownerPrefix } from "./cloud-run-state";
import { statsPath } from "./stats";

// ── Database ─────────────────────────────────────────────────────────

export async function exportUserRows(db: Db, id: string) {
  const owned = await db.select().from(lessons).where(eq(lessons.userId, id));
  const lessonIds = owned.map((lesson) => lesson.id);
  return {
    users: await db.select().from(users).where(eq(users.id, id)),
    lessons: owned,
    lessonSteps: lessonIds.length ? await db.select().from(lessonSteps).where(inArray(lessonSteps.lessonId, lessonIds)) : [],
    lessonMessages: lessonIds.length ? await db.select().from(lessonMessages).where(inArray(lessonMessages.lessonId, lessonIds)) : [],
    contributions: await db.select().from(contributions).where(eq(contributions.userId, id)),
    mapCoverage: await db.select().from(mapCoverage).where(eq(mapCoverage.userId, id)),
    standingEvents: await db.select().from(standingEvents).where(eq(standingEvents.userId, id)),
    alerts: await db.select().from(alerts).where(eq(alerts.userId, id)),
    // Names and dates only: a token's hash is a credential, not the user's data.
    harnessTokens: await db.select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt })
      .from(apiTokens).where(eq(apiTokens.userId, id)),
    harnessEvents: await db.select().from(harnessEvents).where(eq(harnessEvents.userId, id)),
  };
}

/** Remove the account's row; the foreign keys cascade to everything it owns.
 *  Returns how many users rows went (0 or 1). */
export async function deleteUserRows(db: Db, id: string): Promise<number> {
  if (!id) throw new RangeError("A user id is required");
  return (await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })).length;
}

// ── Blob (hosted) ────────────────────────────────────────────────────

type BlobEntry = { pathname: string; size: number; uploadedAt: Date };

/** The slice of @vercel/blob used here; tests pass an in-memory one. */
export type BlobStore = {
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ blobs: BlobEntry[]; cursor?: string; hasMore: boolean }>;
  del(pathnames: string[]): Promise<void>;
};

/** users/<hash>/ (a directory) and stats/<hash>.json (one file). */
export function userBlobPaths(id: string): { prefix: string; stats: string } {
  return { prefix: ownerPrefix(id).slice(0, -"runs/".length), stats: statsPath(id) };
}

function ownedPath(id: string, pathname: string): boolean {
  const { prefix, stats } = userBlobPaths(id);
  return pathname.startsWith(prefix) || pathname === stats;
}

/** Every Blob record the account owns. */
export async function listUserBlobs(store: Pick<BlobStore, "list">, id: string): Promise<BlobEntry[]> {
  const { prefix, stats } = userBlobPaths(id);
  const out = new Map<string, BlobEntry>();
  for (const listPrefix of [prefix, stats]) {
    let cursor: string | undefined;
    do {
      const page = await store.list({ prefix: listPrefix, cursor, limit: 1000 });
      for (const blob of page.blobs) if (ownedPath(id, blob.pathname)) out.set(blob.pathname, blob);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return [...out.values()];
}

/** Delete every Blob record the account owns; returns how many. */
export async function deleteUserBlobs(store: BlobStore, id: string): Promise<number> {
  const paths = (await listUserBlobs(store, id)).map((blob) => blob.pathname);
  for (let i = 0; i < paths.length; i += 100) await store.del(paths.slice(i, i + 100));
  return paths.length;
}

// ── Local (.dispatches) ──────────────────────────────────────────────

// Local run ids (lib/dispatcher.ts DISPATCH_ID_RE). Anything else in the
// directory (caches, stats/, lifecycle/, fork-ci/) is never a run.
const RUN_ID = /^d_[A-Za-z0-9_-]{1,64}$/;

/** Run sidecars in `dir` whose recorded owner is `id`. */
export function localUserRuns(dir: string, id: string): Array<Record<string, unknown> & { id: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown> & { id: string }> = [];
  for (const file of readdirSync(dir)) {
    const runId = file.slice(0, -".json".length);
    if (!file.endsWith(".json") || !RUN_ID.test(runId)) continue;
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) continue; // a half-written sidecar names no owner
      throw error;
    }
    const value = record as { id?: unknown; auth0_user_id?: unknown } | null;
    if (value?.id === runId && value.auth0_user_id === id) out.push(value as Record<string, unknown> & { id: string });
  }
  return out;
}

/** The account's local activity counters, or null. */
export function localUserStats(dir: string, id: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, statsPath(id)), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Delete the account's runs (sidecar, log, run directory) and counters;
 *  returns how many runs went. */
export function deleteLocalUserData(dir: string, id: string): number {
  const runs = localUserRuns(dir, id);
  for (const run of runs) {
    for (const path of [`${run.id}.json`, `${run.id}.log`, run.id]) rmSync(join(dir, path), { recursive: true, force: true });
  }
  rmSync(join(dir, statsPath(id)), { force: true });
  return runs.length;
}
