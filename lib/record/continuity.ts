// Contributor continuity (PLAN §9.5.2, plus the home project). When the record
// sync (lib/record/sync.ts) sees a PR merged, recordMerge:
//   - marks the PR's files "changed" on the project map (lib/record/map.ts);
//   - keeps the area they sit in for a "Next in <area>" card, ranked by §6.4
//     with that area weighted up (RANK.nextInArea);
//   - on the user's CONTINUITY.homeAfterMerges-th merged PR in one repository,
//     makes it their home project, unless they already chose or cleared one.
//     Recommendations favour it (RANK.homeProject); /issues and /discover list
//     it first. The user changes or clears it on /account.
// Both live in users.settings (homeProject, nextInArea), so "Export my data"
// and "Delete my data" (lib/account-data.ts) cover them with the users row.

import { and, eq, sql } from "drizzle-orm";
import { splitRepo } from "../ai-policy";
import type { Db } from "../db/client";
import { contributions, repos, users } from "../db/schema";
import type { GraphData } from "../graph";
import { loadCandidates, loadUser, rankCandidate, type Ranked } from "../recs/rank";
import { RANK } from "../recs/weights";
import { areaOf, findRepoId, graphAreas, MAP, markNodes, nodesForFiles } from "./map";
import { assertUser, UnknownUserError } from "./standing";

export const CONTINUITY = {
  /** Merged PRs in one repository (opensrcer's and imported) that make it the home project. */
  homeAfterMerges: 2,
  /** How long the "Next in <area>" card stays after the merge. */
  nextDays: 30,
  /** Issues on the card. */
  nextIssues: 3,
} as const;

export type NextInArea = { repo: string; pr: number; area: string | null; nodes: string[]; at: string };
type Settings = { homeProject?: string | null; nextInArea?: NextInArea };

export class NotYourProjectError extends Error {
  constructor(repo: string) {
    super(`${repo.slice(0, 200)} is not a repository in your record.`);
    this.name = "NotYourProjectError";
  }
}

async function settingsOf(db: Db, userId: string): Promise<Settings> {
  const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new UnknownUserError(userId);
  return row.settings as Settings;
}

/** Merged into settings in the database, like lib/users.ts completeOnboarding. */
async function patchSettings(db: Db, userId: string, patch: Settings): Promise<void> {
  await db.update(users).set({ settings: sql`${users.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(users.id, userId));
}

export type MergedPr = { userId: string; repoId: number; repoFull: string; prNumber: number; files: string[] };

/** A PR just merged: map, "Next in <area>" and maybe the home project.
 *  `graph` is the repository's code graph, or null (then only the home project moves). */
export async function recordMerge(db: Db, pr: MergedPr, graph: GraphData | null, now = new Date()): Promise<{ changed: number; area: string | null; home: boolean }> {
  if (!Number.isSafeInteger(pr.prNumber) || pr.prNumber < 1) throw new RangeError(`Not a PR number: ${pr.prNumber}`);
  const settings = await settingsOf(db, pr.userId);
  const nodes = graph ? nodesForFiles(graph, pr.files).slice(0, MAP.maxMark) : [];
  const changed = await markNodes(db, pr.userId, pr.repoFull, { level: "changed", nodes }, now);
  const area = graph && nodes.length ? areaOf(nodes, graphAreas(graph)) : null;
  const [{ merged }] = await db.select({ merged: sql<number>`count(*)::int` }).from(contributions)
    .where(and(eq(contributions.userId, pr.userId), eq(contributions.repoId, pr.repoId), eq(contributions.state, "merged")));
  // A choice the user made (a repository or null for "none") always stands.
  const home = merged >= CONTINUITY.homeAfterMerges && !Object.hasOwn(settings, "homeProject");
  await patchSettings(db, pr.userId, {
    nextInArea: { repo: pr.repoFull, pr: pr.prNumber, area: area?.name ?? null, nodes: (area?.ids ?? nodes).slice(0, MAP.maxMark), at: now.toISOString() },
    ...(home ? { homeProject: pr.repoFull } : {}),
  });
  return { changed, area: area?.name ?? null, home };
}

// ── Home project ──────────────────────────────────────────────────────

/** owner/name, or null when there is none. */
export async function homeProject(db: Db, userId: string): Promise<string | null> {
  const home = (await settingsOf(db, userId)).homeProject;
  return typeof home === "string" ? home : null;
}

/** The repositories the user can pick as home: every one in their record. */
export async function homeChoices(db: Db, userId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ owner: repos.owner, name: repos.name }).from(contributions)
    .innerJoin(repos, eq(repos.id, contributions.repoId)).where(eq(contributions.userId, userId));
  return rows.map((r) => `${r.owner}/${r.name}`).sort((a, b) => a.localeCompare(b));
}

/** The user's own choice: a repository in their record, or null for none
 *  (after which no merge picks one for them again). Returns what was stored. */
export async function setHomeProject(db: Db, userId: string, repo: string | null): Promise<string | null> {
  if (repo !== null) splitRepo(repo); // InvalidRepoNameError before anything else
  await assertUser(db, userId);
  let home: string | null = null;
  if (repo !== null) {
    home = (await homeChoices(db, userId)).find((r) => r.toLowerCase() === repo.toLowerCase()) ?? null;
    if (!home) throw new NotYourProjectError(repo);
  }
  await patchSettings(db, userId, { homeProject: home });
  return home;
}

// ── Next in <area> ────────────────────────────────────────────────────

export type NextCard = { repo: string; pr: number; area: string | null; issues: Ranked[] };

/** The card after the latest merge: open issues in that repository, ranked
 *  (§6.4) with its area counted as known code and weighted up. Null when no
 *  merge is recent enough, or the repository has nothing open in the catalog. */
export async function nextInArea(db: Db, userId: string, now = new Date()): Promise<NextCard | null> {
  const next = (await settingsOf(db, userId)).nextInArea;
  if (!next || now.getTime() - Date.parse(next.at) > CONTINUITY.nextDays * 86_400_000) return null;
  const repoId = await findRepoId(db, next.repo);
  if (repoId === null) return null;
  const user = await loadUser(db, userId, []);
  const known = new Map(user.known);
  known.set(repoId, new Set([...(user.known.get(repoId) ?? []), ...next.nodes]));
  const profile = { ...user, known };
  const issues = (await loadCandidates(db, { repoIds: [repoId] }))
    .map((candidate) => rankCandidate(candidate, profile, RANK.knownArea + RANK.nextInArea))
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, CONTINUITY.nextIssues);
  return issues.length ? { repo: next.repo, pr: next.pr, area: next.area, issues } : null;
}
