// Postgres schema (PLAN.md §2.3). Postgres holds what has to be queried:
// levels, coverage, similarity and ranked searches. Big blobs (logs,
// previews, graphs, patches) stay in Blob. Columns are camelCase here and
// snake_case in the database (`casing: "snake_case"` in client.ts and
// drizzle.config.ts). After changing this file run `npx drizzle-kit generate`.

import { sql, type SQL } from "drizzle-orm";
import {
  bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, serial, text,
  timestamp, unique, uuid, vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const at = () => timestamp({ withTimezone: true });
const createdAt = () => at().notNull().defaultNow();

/** Dimensions of Voyage's voyage-3.5 / voyage-code-3 embeddings. */
export const EMBEDDING_DIMENSIONS = 1024;

export const users = pgTable("users", {
  id: text().primaryKey(), // "github|<numeric id>", the Auth0 user id
  login: text().notNull(),
  createdAt: createdAt(),
  level: integer().notNull().default(0),
  standing: integer().notNull().default(0),
  // Path preference, digest opt-in, public profile opt-in, and what first-run
  // onboarding asked (lib/users.ts: languages, interests, experience).
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  // Set when /welcome is finished or skipped; null shows it after sign-in.
  onboardedAt: at(),
}, (t) => [index().on(t.login)]);

export const repos = pgTable("repos", {
  id: serial().primaryKey(),
  // GitHub's canonical case, from the API; GitHub itself is case-insensitive.
  owner: text().notNull(),
  name: text().notNull(),
  defaultBranch: text(),
  language: text(),
  stars: integer().notNull().default(0),
  archived: boolean().notNull().default(false),
  catalog: boolean().notNull().default(false), // in the recommendation catalog
  health: jsonb().$type<Record<string, unknown>>(),
  updatedAt: createdAt(),
  // When lib/recs/ingest.ts last finished this repo: the next run asks GitHub
  // only for issues updated since then.
  ingestedAt: at(),
  // lib/repo-profile.ts: the unwritten rules, measured from recent PRs.
  profile: jsonb().$type<Record<string, unknown>>(),
  profiledAt: at(),
}, (t) => [unique().on(t.owner, t.name), index().on(t.catalog)]);

const repoId = () => integer().notNull().references(() => repos.id, { onDelete: "cascade" });
const userId = () => text().notNull().references(() => users.id, { onDelete: "cascade" });

export const envRecipes = pgTable("env_recipes", {
  repoId: repoId(),
  recipeHash: text().notNull(),
  source: text({ enum: ["devcontainer", "ci", "mise", "lockfile", "railpack", "agent", "builtin"] }).notNull(),
  recipe: jsonb().notNull(),
  baseline: jsonb(), // tests already failing on main
  greenAt: at(),
  lastUsedAt: at(),
  status: text({ enum: ["green", "partial", "unreachable"] }).notNull(),
  unreachableReason: text(),
}, (t) => [primaryKey({ columns: [t.repoId, t.recipeHash] })]);

export const envSnapshots = pgTable("env_snapshots", {
  snapshotId: text().primaryKey(),
  repoId: repoId(),
  recipeHash: text().notNull(),
  baseSha: text().notNull(),
  sizeBytes: bigint({ mode: "number" }),
  createdAt: createdAt(),
  lastUsedAt: at(),
}, (t) => [index().on(t.repoId, t.recipeHash)]);

export const issues = pgTable("issues", {
  repoId: repoId(),
  number: integer().notNull(),
  title: text().notNull(),
  bodyExcerpt: text().notNull().default(""),
  labels: text().array().notNull().default(sql`'{}'::text[]`),
  state: text({ enum: ["open", "closed"] }).notNull(),
  createdAt: at().notNull(),
  closedAt: at(),
  authorAssoc: text(),
  comments: integer().notNull().default(0),
  closingPr: integer(),
  fixFiles: integer(),
  fixAdd: integer(),
  fixDel: integer(),
  reviewRounds: integer(),
  mergeHours: integer(),
  difficulty: real(),
  difficultyReasons: jsonb(),
  // What the difficulty was computed from (lib/recs/difficulty.ts
  // DifficultyFeatures), kept so calibration can refit without refetching.
  features: jsonb().$type<Record<string, unknown>>(),
  scopeNodes: text().array(),
  embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
  // Full-text side of the hybrid search. Generated, so it can never drift
  // from the text it indexes.
  tsv: tsvector().generatedAlwaysAs((): SQL => sql`to_tsvector('english', ${issues.title} || ' ' || ${issues.bodyExcerpt})`),
}, (t) => [
  primaryKey({ columns: [t.repoId, t.number] }),
  index().on(t.state),
  index().using("gin", t.tsv),
  index().using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const lessons = pgTable("lessons", {
  id: uuid().primaryKey().defaultRandom(),
  userId: userId(),
  repoId: repoId(),
  issueNumber: integer().notNull(),
  runId: text(), // the hidden fix run
  path: text({ enum: ["ai", "self"] }),
  stage: text().notNull(),
  mode: text({ enum: ["short", "full"] }).notNull().default("short"),
  answerKeyStatus: text({ enum: ["verified", "unverified", "failed"] }),
  revealedAt: at(),
  startedAt: createdAt(),
  finishedAt: at(),
  ideSandbox: text(),
  // lib/lesson/db-store.ts: the rest of lib/lesson/store.ts Lesson.
  gaveUp: boolean().notNull().default(false),
  turnsUsed: integer().notNull().default(0),
  baseSha: text(), // the commit the code viewer and IDE show
  ideDiff: text(), // path B: the contributor's latest diff
  ideSubmittedAt: at(),
}, (t) => [index().on(t.userId), index().on(t.repoId, t.issueNumber)]);

const lessonId = () => uuid().notNull().references(() => lessons.id, { onDelete: "cascade" });

export const lessonSteps = pgTable("lesson_steps", {
  lessonId: lessonId(),
  step: text().notNull(),
  answer: text(),
  grade: jsonb(),
  hintsUsed: integer().notNull().default(0),
  attempts: integer().notNull().default(0),
  updatedAt: createdAt(),
  done: boolean().notNull().default(false),
  hintLevel: integer().notNull().default(-1), // highest hint shown (-1: none)
  hintLevels: integer().array().notNull().default(sql`'{}'::integer[]`), // every level shown
}, (t) => [primaryKey({ columns: [t.lessonId, t.step] })]);

export const lessonMessages = pgTable("lesson_messages", {
  lessonId: lessonId(),
  seq: integer().notNull(),
  role: text().notNull(),
  content: text().notNull(),
  createdAt: createdAt(),
  step: text(), // the step the message was about, if any
}, (t) => [primaryKey({ columns: [t.lessonId, t.seq] })]);

export const contributions = pgTable("contributions", {
  id: serial().primaryKey(),
  userId: userId(),
  lessonId: uuid().references(() => lessons.id, { onDelete: "set null" }),
  repoId: repoId(),
  prNumber: integer().notNull(),
  path: text({ enum: ["ai", "self"] }),
  state: text({ enum: ["open", "merged", "closed"] }).notNull(),
  openedAt: at().notNull(),
  mergedAt: at(),
  reviewRounds: integer().notNull().default(0),
  approvedByMaintainer: boolean().notNull().default(false),
  respondedToReview: boolean().notNull().default(false),
  source: text({ enum: ["opensrcer", "imported"] }).notNull(),
}, (t) => [unique().on(t.repoId, t.prNumber), index().on(t.userId)]);

export const mapCoverage = pgTable("map_coverage", {
  userId: userId(),
  repoId: repoId(),
  nodeId: text().notNull(),
  level: text({ enum: ["explored", "explained", "changed"] }).notNull(),
  at: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.repoId, t.nodeId] })]);

/** Append-only, so levels and standing can always be rebuilt from it. */
export const standingEvents = pgTable("standing_events", {
  id: serial().primaryKey(),
  userId: userId(),
  kind: text().notNull(),
  points: integer().notNull(),
  ref: text(), // what earned it, e.g. "owner/repo#123"
  at: createdAt(),
}, (t) => [
  // The same event for the same thing is never counted twice. Also serves
  // per-user lookups, so user_id needs no index of its own.
  unique().on(t.userId, t.kind, t.ref),
]);

export const alerts = pgTable("alerts", {
  id: serial().primaryKey(),
  userId: userId(),
  repoId: repoId(),
  issueNumber: integer().notNull(),
  reason: jsonb().notNull(),
  createdAt: createdAt(),
  seenAt: at(),
}, (t) => [unique().on(t.userId, t.repoId, t.issueNumber)]);

// The installable harness (harness/, lib/harness.ts): personal tokens, kept
// only as SHA-256 hashes, and what the harness reports for stats.
export const apiTokens = pgTable("api_tokens", {
  id: serial().primaryKey(),
  userId: userId(),
  name: text().notNull(),
  hash: text().notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: at(),
  revokedAt: at(),
}, (t) => [index().on(t.userId)]);

export const harnessEvents = pgTable("harness_events", {
  id: serial().primaryKey(),
  userId: userId(),
  repo: text().notNull(), // owner/name, as GitHub spells it
  type: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  at: createdAt(),
}, (t) => [index().on(t.userId), index().on(t.repo)]);

/** What a lesson run from the harness (lib/harness-lessons.ts) is graded
 *  against. The contributor's agent sends it from their checkout: no hidden
 *  cloud run, no server-side GitHub reads. The key stays here until the reveal. */
export const harnessLessonContext = pgTable("harness_lesson_context", {
  lessonId: uuid().primaryKey().references(() => lessons.id, { onDelete: "cascade" }),
  issueTitle: text().notNull(),
  issueBody: text().notNull(),
  readme: text().notNull(),
  graphGz: text(), // lib/graph.ts GraphData from graphify on the checkout, gzipped JSON in base64 (~10x smaller)
  keyDiff: text(),
  keyDiagnosis: text(),
  keyTitle: text(),
  keyVerified: boolean(), // the key's new test failed before the fix and passes with it
  updatedAt: createdAt(),
});

/** A class invite (lib/classes.ts): one link an instructor shares, admitting
 *  whoever signs in through it while it has uses left and hasn't expired. */
export const classInvites = pgTable("class_invites", {
  code: text().primaryKey(),
  name: text().notNull(), // e.g. "CS 101, Fall 2026": shown to students on the join page
  maxUses: integer().notNull(),
  expiresAt: at().notNull(), // last day to join; members keep access until the invite is revoked
  createdBy: text().notNull(), // the admin's Auth0 subject
  createdAt: createdAt(),
  revokedAt: at(), // revoking ends every member's access through this invite
});

export const classMembers = pgTable("class_members", {
  code: text().notNull().references(() => classInvites.code, { onDelete: "cascade" }),
  userId: userId(),
  joinedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.code, t.userId] }), index().on(t.userId)]);
