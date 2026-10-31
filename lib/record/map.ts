// Project map (PLAN §9.4). Per user and repository, the code-graph nodes they
// have met, on a ladder a node only ever climbs:
//   explored   opened in the code viewer or IDE, or asked the teacher about
//   explained  passed s1/s7/s8 or explain-it about it
//   changed    in one of their merged PRs (lib/record/continuity.ts recordMerge)
// Coverage is counted per area: the graph's modules (buildModuleMap) merged by
// name, minus the tiny ones, so "You know 4 of flask's 12 areas" reads like the
// project rather than like 200 clusters. Stored in map_coverage; shown on
// /account, as an overlay on the graph viz (lib/graph-html.ts), and at the
// start of a lesson in a repository the user has been to before.

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { splitRepo } from "../ai-policy";
import type { Db } from "../db/client";
import { mapCoverage, repos } from "../db/schema";
import { buildModuleMap, hopDistances, questionSubject, type GraphData } from "../graph";
import { touchedNodeIds } from "../graph-impact";
import type { StepContext } from "../lesson/steps/shared";
import { pickNodes, type PickResult } from "../lesson/steps/s7";
import type { StepGrade } from "../lesson/store";
import { assertUser, ensureRepo } from "./standing";

export const MAP = {
  /** An area needs at least this many graph nodes to count; smaller modules are noise. */
  minAreaNodes: 10,
  /** Nodes one mark may write. */
  maxMark: 500,
  /** Nodes a written answer can name at once. */
  maxNamed: 20,
  /** "Next to code you changed": within this many graph hops of it. */
  nearHops: 2,
  /** Repositories /account shows a map for, most recently touched first. */
  maxRepos: 5,
} as const;

export const MAP_LEVELS = ["explored", "explained", "changed"] as const;
export type MapLevel = (typeof MAP_LEVELS)[number];
export type MapMark = { level: MapLevel; nodes: string[] };

const STRENGTH: Record<MapLevel, number> = { explored: 0, explained: 1, changed: 2 };

export class InvalidMapMarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMapMarkError";
  }
}

const strengthSql = (level: SQL | AnyPgColumn) => sql`(case ${level} when 'changed' then 2 when 'explained' then 1 else 0 end)`;

/** Record nodes at `mark.level` for the user in `repoFull`. A node already at
 *  that level or above keeps its level. Validates everything before writing.
 *  Returns how many nodes were new or moved up. */
export async function markNodes(db: Db, userId: string, repoFull: string, mark: MapMark, at = new Date()): Promise<number> {
  if (!(MAP_LEVELS as readonly string[]).includes(mark?.level)) throw new InvalidMapMarkError(`Unknown map level: ${String(mark?.level)}`);
  if (!Array.isArray(mark.nodes) || mark.nodes.length > MAP.maxMark) throw new InvalidMapMarkError(`A mark holds 0-${MAP.maxMark} nodes.`);
  if (mark.nodes.some((node) => typeof node !== "string" || !node || node.length > 300)) throw new InvalidMapMarkError("Node ids are 1-300 characters.");
  await assertUser(db, userId);
  const nodes = [...new Set(mark.nodes)];
  if (!nodes.length) return 0;
  const repoId = await ensureRepo(db, repoFull);
  const rows = await db.insert(mapCoverage).values(nodes.map((nodeId) => ({ userId, repoId, nodeId, level: mark.level, at })))
    .onConflictDoUpdate({
      target: [mapCoverage.userId, mapCoverage.repoId, mapCoverage.nodeId],
      set: { level: sql`excluded.level`, at: sql`excluded.at` },
      setWhere: sql`${strengthSql(mapCoverage.level)} < ${strengthSql(sql`excluded.level`)}`,
    })
    .returning({ nodeId: mapCoverage.nodeId });
  return rows.length;
}

/** A repository's id, matched case-insensitively, or null when it is not in the database. */
export async function findRepoId(db: Db, repoFull: string): Promise<number | null> {
  const [owner, name] = splitRepo(repoFull);
  const [row] = await db.select({ id: repos.id }).from(repos)
    .where(and(eq(sql`lower(${repos.owner})`, owner.toLowerCase()), eq(sql`lower(${repos.name})`, name.toLowerCase()))).limit(1);
  return row?.id ?? null;
}

/** The user's marked nodes in one repository. */
export async function mapLevels(db: Db, userId: string, repoId: number): Promise<Map<string, MapLevel>> {
  const rows = await db.select({ nodeId: mapCoverage.nodeId, level: mapCoverage.level }).from(mapCoverage)
    .where(and(eq(mapCoverage.userId, userId), eq(mapCoverage.repoId, repoId)));
  return new Map(rows.map((row) => [row.nodeId, row.level]));
}

// ── Areas and coverage (pure) ─────────────────────────────────────────

export type Area = { name: string; ids: string[] };

/** The graph's areas: buildModuleMap's modules merged by name, at least
 *  MAP.minAreaNodes nodes each, largest first. */
export function graphAreas(graph: GraphData): Area[] {
  const names = buildModuleMap(graph);
  const byName = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const name = names.get(node.community) ?? `module ${node.community}`;
    byName.set(name, [...(byName.get(name) ?? []), node.id]);
  }
  return [...byName].filter(([, ids]) => ids.length >= MAP.minAreaNodes).map(([name, ids]) => ({ name, ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}

/** The area holding most of `nodeIds`, or null when none is in an area. */
export function areaOf(nodeIds: Iterable<string>, areas: Area[]): Area | null {
  const wanted = new Set(nodeIds);
  let best: Area | null = null;
  let bestHits = 0;
  for (const area of areas) {
    const hits = area.ids.filter((id) => wanted.has(id)).length;
    if (hits > bestHits) { best = area; bestHits = hits; }
  }
  return best;
}

export type AreaCoverage = { name: string; nodes: number; marked: number; level: MapLevel | null };
/** `known`: areas with something explained or changed in them. */
export type Coverage = { areas: AreaCoverage[]; known: string[]; total: number };

/** Per area, how many of its nodes are marked and the highest level reached. */
export function coverage(areas: Area[], levels: Map<string, MapLevel>): Coverage {
  const out = areas.map((area) => {
    let level: MapLevel | null = null;
    let marked = 0;
    for (const id of area.ids) {
      const at = levels.get(id);
      if (!at) continue;
      marked++;
      if (level === null || STRENGTH[at] > STRENGTH[level]) level = at;
    }
    return { name: area.name, nodes: area.ids.length, marked, level };
  });
  return { areas: out, known: out.filter((a) => a.level === "explained" || a.level === "changed").map((a) => a.name), total: out.length };
}

/** The nodes a merged PR's files touched (touchedNodeIds over file headers). */
export function nodesForFiles(graph: GraphData, files: string[]): string[] {
  const paths = files.filter((file) => typeof file === "string" && file.trim());
  if (!paths.length) return [];
  return [...touchedNodeIds(graph, paths.map((file) => `+++ b/${file.trim()}`).join("\n"))];
}

const bare = (s: string) => s.toLowerCase().replace(/\(\)$/, "").replace(/^\./, "");

/** Graph nodes a piece of writing names: exact label matches, as the
 *  teacher's questionSubject does for one. Labels under 3 characters never match. */
export function namedNodes(graph: GraphData, text: string, limit: number = MAP.maxNamed): string[] {
  const words = new Set((text.match(/[A-Za-z_][\w.]*(?:\(\))?/g) ?? []).map(bare));
  const out: string[] = [];
  for (const node of graph.nodes) {
    if (out.length >= limit) break;
    const label = bare(node.label);
    if (label.length >= 3 && !/rationale/.test(node.id) && words.has(label)) out.push(node.id);
  }
  return out;
}

/** A teacher question marks its subject explored. */
export function askedMark(graph: GraphData | null, message: string): MapMark | null {
  const subject = graph ? questionSubject(graph, message) : null;
  return subject ? { level: "explored", nodes: [subject.id] } : null;
}

/** What a passed step marks explained. s1 and s8: the code the answer names
 *  (never the hidden fix's nodes: before the reveal the map must not point at
 *  the fix). s7: the picks that were on target or close. explain-it, after the
 *  reveal: the fix's own nodes. Null when nothing is marked. */
export function passedMark(step: string, answer: unknown, grade: StepGrade | null, ctx: Pick<StepContext, "graph" | "answerKey">): MapMark | null {
  const graph = ctx.graph;
  if (!grade?.passed || !graph) return null;
  let nodes: string[] = [];
  if (step === "s1" || step === "s8") nodes = namedNodes(graph, typeof answer === "string" ? answer : "");
  else if (step === "s7") {
    const results = ((grade.detail as { results?: PickResult[] } | undefined)?.results ?? []).filter((r) => r.verdict !== "red_herring");
    // The same normalising s7's grader applies before pickNodes.
    const norm = (s: string) => s.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\(\)$/, "").replace(/^`|`$/g, "").toLowerCase();
    nodes = results.flatMap((r) => pickNodes(graph, norm(r.pick)));
  } else if (step === "explain-it" && ctx.answerKey) nodes = [...touchedNodeIds(graph, ctx.answerKey.diff)];
  nodes = [...new Set(nodes)].slice(0, MAP.maxMark);
  return nodes.length ? { level: "explained", nodes } : null;
}

/** "You've been here before" for a new lesson: what the user knows of the
 *  repository, and the area of the issue's nodes that sit within
 *  MAP.nearHops of code they changed. Null on a first visit. */
export function lessonNote(graph: GraphData, levels: Map<string, MapLevel>, scopeNodes: string[]): { known: string[]; total: number; nearChanged: string | null } | null {
  if (!levels.size) return null;
  const areas = graphAreas(graph);
  const { known, total } = coverage(areas, levels);
  const changed = [...levels].filter(([, level]) => level === "changed").map(([id]) => id);
  let nearChanged: string | null = null;
  if (changed.length) {
    const distances = hopDistances(graph, changed, MAP.nearHops);
    const near = scopeNodes.filter((id) => distances.has(id));
    // ponytail: "" when the nodes sit outside every named area; the note then says "code you changed".
    if (near.length) nearChanged = areaOf(near, areas)?.name ?? "";
  }
  return { known, total, nearChanged };
}

// ── /account ──────────────────────────────────────────────────────────

export type RepoMap = { repo: string; counts: Record<MapLevel, number>; coverage: Coverage | null };

/** The user's maps, most recently touched repository first. `coverage` is
 *  null when the repository has no graph to count areas in. */
export async function repoMaps(db: Db, userId: string, loadGraph: (repo: string) => Promise<GraphData | null>): Promise<RepoMap[]> {
  const touched = await db.select({ repoId: mapCoverage.repoId, owner: repos.owner, name: repos.name, last: sql<string>`max(${mapCoverage.at})` })
    .from(mapCoverage).innerJoin(repos, eq(repos.id, mapCoverage.repoId)).where(eq(mapCoverage.userId, userId))
    .groupBy(mapCoverage.repoId, repos.owner, repos.name).orderBy(desc(sql`max(${mapCoverage.at})`)).limit(MAP.maxRepos);
  const out: RepoMap[] = [];
  for (const row of touched) {
    const repo = `${row.owner}/${row.name}`;
    const levels = await mapLevels(db, userId, row.repoId);
    const counts = { explored: 0, explained: 0, changed: 0 };
    for (const level of levels.values()) counts[level]++;
    const graph = await loadGraph(repo);
    out.push({ repo, counts, coverage: graph ? coverage(graphAreas(graph), levels) : null });
  }
  return out;
}
