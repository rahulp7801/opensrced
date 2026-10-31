// Levels (PLAN §9.2). Every number is a knob here and nowhere else. A level
// is computed from standing events (lib/record/standing.ts), never stored as
// the only truth: users.level is a cache that rebuildStanding rewrites.
//
//   newcomer     default
//   contributor  1 merged PR through opensrcer, or 1 merged public PR imported
//   regular      3 merged in one project, or 5 across 2+ projects; 1+ through
//                path B (write it yourself); replied to every review; no spam flag
//   trusted      regular, plus 10 merged; 3+ through path B; 2+ maintainer
//                approvals; 3+ kickoff-brief reviews given
//
// Imported history counts only up to contributor. Levels never go down for
// honest failures; an open spam flag freezes level-ups and drops PR caps to
// newcomer until it is reviewed.

export const LEVELS = ["newcomer", "contributor", "regular", "trusted"] as const;
export type Level = (typeof LEVELS)[number];

export const CONTRIBUTOR = { merged: 1, importedMerged: 1 } as const;
export const REGULAR = { mergedInOneRepo: 3, mergedAcrossRepos: 5, acrossRepos: 2, pathB: 1 } as const;
export const TRUSTED = { merged: 10, pathB: 3, approvals: 2, briefReviews: 3 } as const;

/** PR caps per level (PLAN §9.2 table). Newcomer's come from prCaps() in
 *  lib/contrib-guard.ts (today's env defaults); a level never gets less. */
export const LEVEL_CAPS: Record<Exclude<Level, "newcomer">, { daily: number; perRepo: number }> = {
  contributor: { daily: 2, perRepo: 1 },
  regular: { daily: 3, perRepo: 2 },
  trusted: { daily: 5, perRepo: 2 },
};

/** What the level rules read, tallied from standing events. */
export type LevelStats = {
  /** Merged through opensrcer, by repository ("owner/name", lower case). */
  mergedByRepo: Record<string, number>;
  pathB: number;
  importedMerged: number;
  approvals: number;
  briefReviews: number;
  /** Finished PRs with a review the author never answered. */
  unansweredReviews: number;
  spamFlagged: boolean;
};

export const emptyStats = (): LevelStats => ({ mergedByRepo: {}, pathB: 0, importedMerged: 0, approvals: 0, briefReviews: 0, unansweredReviews: 0, spamFlagged: false });

export const levelIndex = (level: Level) => LEVELS.indexOf(level);

/** The level the stats qualify for right now (no history, no freeze). Pure. */
export function qualifiedLevel(s: LevelStats): Level {
  const counts = Object.values(s.mergedByRepo);
  const merged = counts.reduce((a, b) => a + b, 0);
  const regular = s.pathB >= REGULAR.pathB && s.unansweredReviews === 0 && !s.spamFlagged && (
    Math.max(0, ...counts) >= REGULAR.mergedInOneRepo ||
    (merged >= REGULAR.mergedAcrossRepos && counts.length >= REGULAR.acrossRepos));
  if (regular && merged >= TRUSTED.merged && s.pathB >= TRUSTED.pathB && s.approvals >= TRUSTED.approvals && s.briefReviews >= TRUSTED.briefReviews) return "trusted";
  if (regular) return "regular";
  // Imported merges count here and nowhere above: outside history alone can't reach regular.
  return merged >= CONTRIBUTOR.merged || s.importedMerged >= CONTRIBUTOR.importedMerged ? "contributor" : "newcomer";
}
