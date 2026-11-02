// "You know this code" alerts (PLAN §9.5.1), in-app only: no email. When the
// nightly ingest (lib/recs/ingest.ts) finds a new open issue nobody has
// claimed whose scope nodes overlap code a user has explained or changed
// (lib/record/map.ts), it writes an alerts row for that user. At most
// ALERTS.perWeek per user in any rolling week, dismissed ones included, so
// the list never turns into a firehose. Shown, unread only, on /issues;
// dismissed with POST /api/record/feed. Rows cascade with the user.

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { alerts, issues, mapCoverage, repos } from "../db/schema";
import type { GraphData } from "../graph";
import { areaOf, graphAreas } from "./map";

export const ALERTS = {
  /** Alerts one user gets in any rolling ALERTS.windowDays. */
  perWeek: 3,
  windowDays: 7,
  /** Overlapping nodes kept on an alert's reason. */
  reasonNodes: 10,
  /** Unread alerts the feed shows. */
  shown: 10,
} as const;

export type NewIssue = { number: number; scopeNodes: string[] };
export type AlertReason = { kind: "known_code"; nodes: string[]; changed: boolean; area: string | null };
export type PickedAlert = { userId: string; number: number; overlap: string[] };

export class UnknownAlertError extends Error {
  constructor(id: unknown) {
    super(`No alert ${String(id).slice(0, 50)}`);
    this.name = "UnknownAlertError";
  }
}

/** Which users hear about which new issues. Per user: the issues with the
 *  most overlap first (then the lowest number), up to what is left of their
 *  weekly allowance. `file:` tokens are not graph nodes and never match. Pure. */
export function pickAlerts(newIssues: NewIssue[], known: Map<string, Set<string>>, sentThisWeek: Map<string, number>, perWeek: number = ALERTS.perWeek): PickedAlert[] {
  const picked: PickedAlert[] = [];
  for (const [userId, nodes] of known) {
    const left = perWeek - (sentThisWeek.get(userId) ?? 0);
    if (left <= 0) continue;
    const hits = newIssues
      .map((issue) => ({ userId, number: issue.number, overlap: [...new Set(issue.scopeNodes)].filter((n) => !n.startsWith("file:") && nodes.has(n)) }))
      .filter((hit) => hit.overlap.length)
      .sort((a, b) => b.overlap.length - a.overlap.length || a.number - b.number);
    picked.push(...hits.slice(0, left));
  }
  return picked;
}

/** Write alerts for one repository's new issues. `graph` names the area on
 *  the alert when there is one. Returns how many alerts were written. */
export async function createAlerts(db: Db, repoId: number, newIssues: NewIssue[], graph: GraphData | null, now = new Date()): Promise<number> {
  if (!Number.isSafeInteger(repoId) || repoId < 1) throw new RangeError("repoId must be a positive integer");
  const nodes = [...new Set(newIssues.flatMap((issue) => issue.scopeNodes.filter((n) => !n.startsWith("file:"))))];
  if (!nodes.length) return 0;
  const rows = await db.select({ userId: mapCoverage.userId, nodeId: mapCoverage.nodeId, level: mapCoverage.level }).from(mapCoverage)
    .where(and(eq(mapCoverage.repoId, repoId), inArray(mapCoverage.level, ["explained", "changed"]), inArray(mapCoverage.nodeId, nodes)));
  if (!rows.length) return 0;
  const known = new Map<string, Set<string>>();
  const changed = new Set<string>();
  for (const row of rows) {
    known.set(row.userId, (known.get(row.userId) ?? new Set()).add(row.nodeId));
    if (row.level === "changed") changed.add(`${row.userId} ${row.nodeId}`);
  }
  const since = new Date(now.getTime() - ALERTS.windowDays * 86_400_000);
  const sent = await db.select({ userId: alerts.userId, n: sql<number>`count(*)::int` }).from(alerts)
    .where(and(inArray(alerts.userId, [...known.keys()]), gt(alerts.createdAt, since))).groupBy(alerts.userId);
  const picked = pickAlerts(newIssues, known, new Map(sent.map((s) => [s.userId, s.n])));
  if (!picked.length) return 0;
  const areas = graph ? graphAreas(graph) : [];
  const inserted = await db.insert(alerts).values(picked.map((p) => ({
    userId: p.userId, repoId, issueNumber: p.number, createdAt: now,
    reason: {
      kind: "known_code", nodes: p.overlap.slice(0, ALERTS.reasonNodes),
      changed: p.overlap.some((n) => changed.has(`${p.userId} ${n}`)), area: areaOf(p.overlap, areas)?.name ?? null,
    } satisfies AlertReason,
  }))).onConflictDoNothing().returning({ id: alerts.id });
  return inserted.length;
}

export type AlertView = { id: number; repo: string; number: number; title: string | null; reason: AlertReason; createdAt: string };

/** The user's unread alerts, newest first. The title is null when the issue
 *  has since left the index. */
export async function unreadAlerts(db: Db, userId: string): Promise<AlertView[]> {
  const rows = await db.select({
    id: alerts.id, owner: repos.owner, name: repos.name, number: alerts.issueNumber, title: issues.title, reason: alerts.reason, createdAt: alerts.createdAt,
  }).from(alerts).innerJoin(repos, eq(repos.id, alerts.repoId))
    .leftJoin(issues, and(eq(issues.repoId, alerts.repoId), eq(issues.number, alerts.issueNumber)))
    .where(and(eq(alerts.userId, userId), isNull(alerts.seenAt))).orderBy(desc(alerts.createdAt), desc(alerts.id)).limit(ALERTS.shown);
  return rows.map(({ owner, name, reason, createdAt, ...row }) => ({ ...row, repo: `${owner}/${name}`, reason: reason as AlertReason, createdAt: createdAt.toISOString() }));
}

/** Dismiss one alert (`id`) or all of them ("all"). Dismissing one twice is
 *  fine; an id that is not the user's is UnknownAlertError. Returns how many
 *  were newly dismissed. */
export async function dismissAlerts(db: Db, userId: string, which: number | "all", now = new Date()): Promise<number> {
  if (which === "all") {
    return (await db.update(alerts).set({ seenAt: now }).where(and(eq(alerts.userId, userId), isNull(alerts.seenAt))).returning({ id: alerts.id })).length;
  }
  if (!Number.isSafeInteger(which) || which < 1) throw new UnknownAlertError(which);
  const [row] = await db.select({ seenAt: alerts.seenAt }).from(alerts).where(and(eq(alerts.id, which), eq(alerts.userId, userId))).limit(1);
  if (!row) throw new UnknownAlertError(which);
  if (row.seenAt) return 0;
  await db.update(alerts).set({ seenAt: now }).where(eq(alerts.id, which));
  return 1;
}
