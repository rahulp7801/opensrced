// Every tunable number in recommendations (PLAN.md §6.2–§6.4), in one place so
// tuning is an edit here and a `node scripts/calibrate-difficulty.mjs`, never a
// hunt through the ranking code.

/** §6.2 hybrid similar-issues score. When a signal is missing for the issue
 *  being matched (no embedding, no scope nodes), the remaining weights are
 *  renormalised to sum to 1. */
export const SIMILAR = {
  cosine: 0.55,
  textRank: 0.25,
  overlap: 0.20,
  /** Below this a "similar" issue is noise, not a worked example. */
  minScore: 0.12,
} as const;

/** §6.3 difficulty v2: points added to a base, then rounded into 1–5.
 *  Negative points make an issue easier. */
export const DIFFICULTY = {
  /** Start here when no solved neighbour exists; the outcome prior replaces it. */
  base: 2,
  /** The k nearest solved issues that form the outcome prior. */
  neighbours: 5,
  /** Fewer solved neighbours than this and the prior is not trusted. */
  minNeighbours: 2,
  /** Median fix size (lines added + deleted) → base difficulty. */
  priorLines: [[10, 1], [40, 2], [150, 3], [400, 4]] as ReadonlyArray<readonly [number, number]>,
  priorLinesAbove: 5,
  priorManyFiles: 4,      // median files touched at or above this…
  priorManyFilesPts: 0.5, // …adds this
  priorReviews: 3,        // median review rounds at or above this…
  priorReviewsPts: 0.5,   // …adds this
  longBody: 1500, longBodyPts: 0.5,
  codeBlocksPts: 0.25,    // more than one code block: a lot to digest
  reproPts: -0.25,
  stackTracePts: -0.25,
  goodFirstPts: -0.75,
  docsPts: -1,
  maintainerReporterPts: -0.25,
  bigRepoStars: 20_000, bigRepoPts: 0.25,
  manyComments: 10, manyCommentsPts: 0.5,
  manyParticipants: 6, manyParticipantsPts: 0.25,
  attemptsPts: 0.75,      // an earlier PR was closed without merging
  oldDays: 365, oldPts: 0.5,
  fanIn: 10, fanInPts: 0.75,          // a touched node with this many dependents
  modules: 3, modulesPts: 0.75,       // spans this many graph modules
} as const;

/** PLAN.md §9.2. Everyone is a Newcomer until the contribution record exists. */
export type Level = "Newcomer" | "Contributor" | "Regular" | "Trusted";

/** §6.4 personalised ranking. */
export const RANK = {
  /** Difficulties each level prefers; one step outside earns half. */
  fit: { Newcomer: [1, 2], Contributor: [2, 3], Regular: [3, 4], Trusted: [3, 5] } as Record<Level, readonly [number, number]>,
  languageMatch: 0.3,
  knownArea: 0.4,
  responsiveness: 0.2,
  workedExamples: 0.1,
  unreachableForLevel: -1.0,
  /** Median hours to a maintainer's first response that still scores fully… */
  responsiveHours: 72,
  /** …and the point past which it scores nothing. */
  unresponsiveHours: 24 * 14,
  /** No merge for this long and the repo counts as unresponsive. */
  staleMergeDays: 180,
  /** "Continue in <repo>": how much more known areas count there. */
  continueKnownArea: 1.0,
  /** "Next in <area>" after a merge (lib/record/continuity.ts): how much more
   *  the merged PR's area counts, on top of knownArea. */
  nextInArea: 1.0,
  /** Every issue in the user's home project (lib/record/continuity.ts). */
  homeProject: 0.5,
} as const;
