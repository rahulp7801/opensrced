// Similar issues and worked examples (PLAN.md §6.2): one hybrid query in
// Postgres, scored
//   0.55 × cosine(embedding) + 0.25 × ts_rank + 0.20 × scope-node overlap
// (weights in lib/recs/weights.ts SIMILAR). Only closed issues fixed by a
// merged PR count as worked examples. Same repo first, then the same language
// across the catalog. A signal the probe lacks (no embedding without
// VOYAGE_API_KEY, no scope nodes) drops out and the rest are renormalised.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { issues, repos } from "../db/schema";
import { EMBED_BODY_CHARS } from "./embed";
import { SIMILAR } from "./weights";

/** What a match is computed against: a stored issue, or any issue's text. */
export type SimilarProbe = {
  repoId: number;
  /** Excluded from its own results when the probe is a stored issue. */
  number?: number;
  language: string | null;
  title: string;
  body: string;
  embedding: number[] | null;
  scopeNodes: string[];
};

export type WorkedExample = {
  repo: string; // owner/name
  number: number;
  title: string;
  url: string;
  closingPr: number;
  prUrl: string;
  fixFiles: number | null;
  fixAdd: number | null;
  fixDel: number | null;
  reviewRounds: number | null;
  mergeHours: number | null;
  closedAt: string | null;
  sameRepo: boolean;
  score: number;
  signals: { cosine: number; text: number; overlap: number };
};

export type SimilarOptions = {
  limit?: number;
  /** Only issues closed before this: calibration must not learn from fixes
   *  that didn't exist yet when the issue was open. */
  closedBefore?: Date;
};

export class IssueNotIndexedError extends Error {
  constructor(repo: string, number: number) { super(`${repo}#${number} is not in the issue index`); this.name = "IssueNotIndexedError"; }
}

/** A Postgres text[] literal. Elements are quoted, so commas and braces in
 *  node ids are data, not syntax. */
export function pgTextArray(values: string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
}

type Row = Omit<WorkedExample, "repo" | "url" | "prUrl" | "signals" | "closedAt"> & {
  owner: string; name: string; closedAt: string | Date | null; cosine: number; text: number; overlap: number;
};

/** Neon returns QueryResult, PGlite { rows }; both carry rows. */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

export async function similarIssues(db: Db, probe: SimilarProbe, options: SimilarOptions = {}): Promise<WorkedExample[]> {
  const limit = options.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError("limit must be an integer from 1 to 50");
  const hasVector = Boolean(probe.embedding?.length);
  const hasScope = probe.scopeNodes.length > 0;
  const weightSum = (hasVector ? SIMILAR.cosine : 0) + SIMILAR.textRank + (hasScope ? SIMILAR.overlap : 0);
  // Our own constants, inlined: a bare numeric parameter has no type for
  // Postgres to infer in arithmetic.
  const score = sql.raw(`(${hasVector ? SIMILAR.cosine : 0} * cosine + ${SIMILAR.textRank} * text + ${hasScope ? SIMILAR.overlap : 0} * overlap) / ${weightSum}`);
  const text = `${probe.title}\n${probe.body.slice(0, EMBED_BODY_CHARS)}`;

  // The probe's own lexemes, OR-ed: plainto_tsquery would AND every word of a
  // whole issue and match nothing. Lexemes are already stemmed, hence 'simple';
  // quotes and backslashes are stripped so each one stays a single quoted term.
  const query = sql`
    with probe as (
      select to_tsquery('simple', coalesce(nullif(array_to_string(array(
        select '''' || translate(lexeme, '''\\', '') || ''''
        from unnest(tsvector_to_array(to_tsvector('english', ${text}))) as lexeme
        where translate(lexeme, '''\\', '') <> ''
      ), ' | '), ''), '''''')) as q
    ), candidates as (
      select r.owner, r.name, i.number, i.title, i.closing_pr as "closingPr",
        i.fix_files as "fixFiles", i.fix_add as "fixAdd", i.fix_del as "fixDel",
        i.review_rounds as "reviewRounds", i.merge_hours as "mergeHours", i.closed_at as "closedAt",
        (i.repo_id = ${probe.repoId}) as "sameRepo",
        ${hasVector ? sql`case when i.embedding is null then 0 else greatest(0, 1 - (i.embedding <=> ${`[${probe.embedding!.join(",")}]`}::vector)) end` : sql`0`}::float8 as cosine,
        ts_rank(i.tsv, probe.q)::float8 as raw_text,
        ${hasScope ? sql`(select count(*) from unnest(i.scope_nodes) as node where node = any(${pgTextArray(probe.scopeNodes)}::text[]))::float8 / ${sql.raw(String(probe.scopeNodes.length))}` : sql`0`}::float8 as overlap
      from issues i join repos r on r.id = i.repo_id, probe
      where i.state = 'closed' and i.closing_pr is not null
        and not (i.repo_id = ${probe.repoId} and i.number = ${probe.number ?? -1})
        and (i.repo_id = ${probe.repoId} or (r.catalog and r.language = ${probe.language}))
        ${options.closedBefore ? sql`and i.closed_at < ${options.closedBefore.toISOString()}::timestamptz` : sql``}
    ), scored as (
      select *, coalesce(raw_text / nullif(max(raw_text) over (), 0), 0) as text from candidates
    )
    select *, ${score} as score from scored
    where ${score} >= ${sql.raw(String(SIMILAR.minScore))}
    order by "sameRepo" desc, score desc, number desc
    limit ${sql.raw(String(limit))}`;

  return rowsOf<Row>(await db.execute(query)).map((row) => {
    const repo = `${row.owner}/${row.name}`;
    const round = (value: number) => Math.round(Number(value) * 1000) / 1000;
    return {
      repo, number: row.number, title: row.title, url: `https://github.com/${repo}/issues/${row.number}`,
      closingPr: row.closingPr, prUrl: `https://github.com/${repo}/pull/${row.closingPr}`,
      fixFiles: row.fixFiles, fixAdd: row.fixAdd, fixDel: row.fixDel, reviewRounds: row.reviewRounds, mergeHours: row.mergeHours,
      closedAt: row.closedAt === null ? null : new Date(row.closedAt).toISOString(),
      sameRepo: Boolean(row.sameRepo), score: round(row.score),
      signals: { cosine: round(row.cosine), text: round(row.text), overlap: round(row.overlap) },
    };
  });
}

/** The probe for a stored issue. Throws IssueNotIndexedError when the repo
 *  isn't ingested or the issue isn't in it. GitHub names are case-insensitive. */
export async function probeFor(db: Db, owner: string, name: string, number: number): Promise<SimilarProbe> {
  const [row] = await db.select({
    repoId: issues.repoId, number: issues.number, language: repos.language, title: issues.title, body: issues.bodyExcerpt,
    embedding: issues.embedding, scopeNodes: issues.scopeNodes,
  }).from(issues).innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(sql`lower(${repos.owner}) = ${owner.toLowerCase()}`, sql`lower(${repos.name}) = ${name.toLowerCase()}`, eq(issues.number, number)))
    .limit(1);
  if (!row) throw new IssueNotIndexedError(`${owner}/${name}`, number);
  return { ...row, scopeNodes: row.scopeNodes ?? [] };
}

export async function similarToIssue(db: Db, owner: string, name: string, number: number, options: SimilarOptions = {}): Promise<WorkedExample[]> {
  return similarIssues(db, await probeFor(db, owner, name, number), options);
}
