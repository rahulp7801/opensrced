// Repo responsiveness (PLAN.md §6.1 "Repo health"), computed only from what
// the ingest already fetched: CHAOSS Time to First Response on issues and PRs,
// how often outside contributors get merged, and how long since any merge.
// Stored in repos.health; lib/recs/rank.ts turns it into a 0–1 score.

import { RANK } from "./weights";

const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const HOUR = 3_600_000;

export function isMaintainer(association: string | null | undefined): boolean {
  return MAINTAINER.has(association ?? "");
}

const isBot = (login: string | null | undefined) => /\[bot\]$/i.test(login ?? "");

export type ResponseEvent = { createdAt: string; authorAssociation?: string | null; author?: { login: string } | null };

/** Hours from `createdAt` to the first comment or review by a maintainer other
 *  than the author, or null when no maintainer has responded. Bots never count. */
export function firstMaintainerResponseHours(createdAt: string, authorLogin: string | null | undefined, events: ResponseEvent[]): number | null {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) throw new Error(`Invalid createdAt: ${createdAt}`);
  let first = Infinity;
  for (const event of events) {
    const login = event.author?.login;
    if (!isMaintainer(event.authorAssociation) || isBot(login) || (login && login === authorLogin)) continue;
    const at = Date.parse(event.createdAt);
    if (Number.isFinite(at) && at >= start) first = Math.min(first, at);
  }
  return first === Infinity ? null : (first - start) / HOUR;
}

export type PrRecord = {
  createdAt: string;
  mergedAt: string | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  authorAssociation: string;
  author: { login: string } | null;
  /** From firstMaintainerResponseHours; null when nobody responded. */
  responseHours: number | null;
};

export type RepoHealth = {
  /** Median hours to a maintainer's first response, over issues filed by non-maintainers. */
  issueResponseHours: number | null;
  prResponseHours: number | null;
  /** Merged ÷ (merged + closed) over finished PRs from non-maintainers. */
  outsiderMergeRate: number | null;
  daysSinceLastMerge: number | null;
  /** How many items each figure is based on. */
  sample: { issues: number; prs: number; outsiderPrs: number };
  computedAt: string;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;

/** `issueResponseHours` holds one entry per non-maintainer issue that got a
 *  maintainer response. Unanswered items are left out of the medians: the
 *  CHAOSS metric times responses, and an unanswered week-old issue would
 *  otherwise pull the median toward its age.
 *  ponytail: unanswered items do show up as a low outsider merge rate; add a
 *  "share answered" figure if a silent repo still ranks too well. */
export function repoHealth(issueResponseHours: number[], prs: PrRecord[], now = new Date()): RepoHealth {
  const outsider = prs.filter((pr) => !isMaintainer(pr.authorAssociation) && !isBot(pr.author?.login));
  const finished = outsider.filter((pr) => pr.state !== "OPEN");
  const merged = finished.filter((pr) => pr.state === "MERGED").length;
  const lastMerge = Math.max(...prs.map((pr) => pr.mergedAt ? Date.parse(pr.mergedAt) : -Infinity));
  return {
    issueResponseHours: round1(median(issueResponseHours)),
    prResponseHours: round1(median(outsider.map((pr) => pr.responseHours).filter((hours): hours is number => hours !== null))),
    outsiderMergeRate: finished.length ? Math.round((merged / finished.length) * 100) / 100 : null,
    daysSinceLastMerge: Number.isFinite(lastMerge) ? Math.max(0, Math.floor((now.getTime() - lastMerge) / (24 * HOUR))) : null,
    sample: { issues: issueResponseHours.length, prs: prs.length, outsiderPrs: outsider.length },
    computedAt: now.toISOString(),
  };
}

/** 0–1 for ranking: 1 when maintainers answer within RANK.responsiveHours, 0
 *  past RANK.unresponsiveHours, linear between. Uses the slower of the issue
 *  and PR medians; a repo with no data scores a neutral 0.5, and one with no
 *  merge in RANK.staleMergeDays scores 0 however quickly it replies. */
export function responsiveness(health: Partial<RepoHealth> | null | undefined): number {
  if ((health?.daysSinceLastMerge ?? 0) > RANK.staleMergeDays) return 0;
  const hours = [health?.issueResponseHours, health?.prResponseHours].filter((value): value is number => typeof value === "number");
  if (!hours.length) return 0.5;
  const slowest = Math.max(...hours);
  if (slowest <= RANK.responsiveHours) return 1;
  if (slowest >= RANK.unresponsiveHours) return 0;
  return 1 - (slowest - RANK.responsiveHours) / (RANK.unresponsiveHours - RANK.responsiveHours);
}
