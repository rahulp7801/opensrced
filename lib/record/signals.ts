// Spam and fit signals (PLAN §9.1). Private to the user in this phase; shaped
// so maintainers could see them later. None of them is a penalty on its own:
// a closed PR costs nothing. Only a burst or a maintainer's objection raises
// a spam flag (lib/record/standing.ts), which freezes level-ups until reviewed.

import { maintainerAiObjection, type TimelineEvent } from "../contrib-guard";

export const SPAM = {
  /** A burst: this many PRs opened on one UTC day across at least `burstRepos` repositories. */
  burstPrs: 10,
  burstRepos: 5,
  /** How far back imported "PRs opened per day" looks. */
  windowDays: 90,
} as const;

export type OpenedPr = { repo: string; createdAt: string; merged: boolean };
export type Burst = { day: string; prs: number; repos: number };
export type Signals = {
  opened: number;
  merged: number;
  /** merged / opened, or null with nothing opened. */
  mergedRatio: number | null;
  bursts: Burst[];
};

/** Opened-to-merged ratio and single-day bursts across many repos. Pure. */
export function spamSignals(prs: OpenedPr[]): Signals {
  const days = new Map<string, { prs: number; repos: Set<string> }>();
  for (const pr of prs) {
    const t = Date.parse(pr.createdAt);
    if (!Number.isFinite(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    const d = days.get(day) ?? { prs: 0, repos: new Set<string>() };
    d.prs++;
    d.repos.add(pr.repo.toLowerCase());
    days.set(day, d);
  }
  const bursts = [...days].filter(([, d]) => d.prs >= SPAM.burstPrs && d.repos.size >= SPAM.burstRepos)
    .map(([day, d]) => ({ day, prs: d.prs, repos: d.repos.size })).sort((a, b) => a.day.localeCompare(b.day));
  const merged = prs.filter((p) => p.merged).length;
  return { opened: prs.length, merged, mergedRatio: prs.length ? merged / prs.length : null, bursts };
}

// Beyond maintainerAiObjection's AI phrases: maintainers calling the PR spam or slop.
const SPAM_OBJECTION = /\b(?:spam(?:my)?|low[- ]effort|(?:AI[- ])?slop)\b/i;
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** The maintainer comment that closed a PR as AI-written or spam, quoted; null when none. Pure. */
export function closingObjection(comments: TimelineEvent[]): string | null {
  const ai = maintainerAiObjection(comments);
  if (ai) return ai.excerpt;
  for (const c of comments) {
    if (c.event !== "commented" || !MAINTAINER.has(c.author_association ?? "") || !c.body) continue;
    const sentence = c.body.split(/(?<=[.!?])\s+|\n+/).find((s) => SPAM_OBJECTION.test(s));
    if (sentence) return sentence.trim().slice(0, 200);
  }
  return null;
}
