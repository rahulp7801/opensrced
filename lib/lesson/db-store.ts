// The lesson store on Postgres (PLAN §2.3): `lessons`, `lesson_steps` and
// `lesson_messages` through Drizzle. lessonStore() is the app's store: PGlite
// locally, Neon when DATABASE_URL is a postgres:// URL (lib/db/client.ts).
// Tests that want no database use MemoryLessonStore.
//
// Lesson ids are the row's uuid with an `l_` prefix, so they keep the shape
// the routes and /api/understand already accept (`l_…`).

import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { lessonMessages, lessons, lessonSteps, repos, users } from "../db/schema";
import { parseRunTarget } from "../run-target";
import { isStepId, type Stage } from "./machine";
import {
  LessonNotFoundError, type Lesson, type LessonMessage, type LessonStep, type LessonStore, type LessonUpdate,
} from "./store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The row key for a public id, or null when it cannot be one of ours. */
export function rowKey(id: string): string | null {
  return id.startsWith("l_") && UUID_RE.test(id.slice(2)) ? id.slice(2) : null;
}

const toDbPath = (path: Lesson["path"]) => (path === "B" ? "self" : "ai");
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : undefined);
/** A timestamp the caller gave as text; an unparseable one leaves the column to its default. */
const when = (text: string | undefined) => {
  const date = text ? new Date(text) : null;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

type LessonRow = typeof lessons.$inferSelect;
type StepRow = typeof lessonSteps.$inferSelect;

function toLesson(row: LessonRow, repo: { owner: string; name: string }, stepRows: StepRow[]): Lesson {
  const steps: Lesson["steps"] = {};
  for (const s of stepRows) {
    if (!isStepId(s.step)) continue;
    steps[s.step] = {
      step: s.step, answer: s.answer ?? "", grade: (s.grade as LessonStep["grade"]) ?? null, done: s.done,
      hint_level: s.hintLevel, hints_used: s.hintLevels, updated_at: s.updatedAt.toISOString(),
    };
  }
  return {
    id: `l_${row.id}`, owner: row.userId, repo_url: `https://github.com/${repo.owner}/${repo.name}`,
    issue_number: row.issueNumber, run_id: row.runId ?? "", mode: row.mode, path: row.path === "self" ? "B" : "A",
    stage: row.stage as Stage, answer_key: row.answerKeyStatus ?? "pending", turns_used: row.turnsUsed,
    ...(row.gaveUp ? { gave_up: true } : {}),
    ...(row.revealedAt ? { revealed_at: iso(row.revealedAt) } : {}),
    created_at: row.startedAt.toISOString(),
    ...(row.baseSha ? { base_sha: row.baseSha } : {}),
    ...(row.ideDiff !== null ? { ide_diff: row.ideDiff } : {}),
    ...(row.ideSubmittedAt ? { ide_submitted_at: iso(row.ideSubmittedAt) } : {}),
    steps,
  };
}

export class DbLessonStore implements LessonStore {
  constructor(private readonly db: () => Promise<Db>) {}

  async get(id: string): Promise<Lesson | null> {
    const key = rowKey(id);
    if (!key) return null;
    const db = await this.db();
    const [found] = await db.select({ lesson: lessons, owner: repos.owner, name: repos.name })
      .from(lessons).innerJoin(repos, eq(repos.id, lessons.repoId)).where(eq(lessons.id, key));
    if (!found) return null;
    const stepRows = await db.select().from(lessonSteps).where(eq(lessonSteps.lessonId, key));
    return toLesson(found.lesson, found, stepRows);
  }

  async findByRun(runId: string): Promise<Lesson | null> {
    if (!runId) return null;
    const [row] = await (await this.db()).select({ id: lessons.id }).from(lessons).where(eq(lessons.runId, runId)).limit(1);
    return row ? this.get(`l_${row.id}`) : null;
  }

  async create(input: Omit<Lesson, "id" | "created_at" | "steps" | "turns_used">): Promise<Lesson> {
    const [owner, name] = parseRunTarget(input.repo_url).repo.split("/");
    const db = await this.db();
    const id = await db.transaction(async (tx) => {
      // ponytail: the user row is created here with the id as its login; the
      // record stream (PLAN §9) owns users and fills the real login.
      await tx.insert(users).values({ id: input.owner, login: input.owner }).onConflictDoNothing();
      const [repo] = await tx.insert(repos).values({ owner, name })
        .onConflictDoUpdate({ target: [repos.owner, repos.name], set: { owner: sql`excluded.owner` } })
        .returning({ id: repos.id });
      const [row] = await tx.insert(lessons).values({
        userId: input.owner, repoId: repo.id, issueNumber: input.issue_number, runId: input.run_id,
        path: toDbPath(input.path), mode: input.mode, stage: input.stage,
        answerKeyStatus: input.answer_key === "pending" ? null : input.answer_key,
        gaveUp: input.gave_up === true, revealedAt: when(input.revealed_at),
        baseSha: input.base_sha, ideDiff: input.ide_diff, ideSubmittedAt: when(input.ide_submitted_at),
      }).returning({ id: lessons.id });
      return row.id;
    });
    return (await this.get(`l_${id}`))!;
  }

  /** The row key of an existing lesson. Throws LessonNotFoundError. */
  private async existing(id: string): Promise<string> {
    const key = rowKey(id);
    if (key) {
      const [row] = await (await this.db()).select({ id: lessons.id }).from(lessons).where(eq(lessons.id, key));
      if (row) return key;
    }
    throw new LessonNotFoundError(id);
  }

  async updateStage(id: string, stage: Stage, fields: LessonUpdate = {}): Promise<Lesson> {
    const key = rowKey(id);
    if (!key) throw new LessonNotFoundError(id);
    const set: Partial<typeof lessons.$inferInsert> = { stage };
    if (fields.answer_key !== undefined) set.answerKeyStatus = fields.answer_key === "pending" ? null : fields.answer_key;
    if (fields.turns_used !== undefined) set.turnsUsed = fields.turns_used;
    if (fields.gave_up !== undefined) set.gaveUp = fields.gave_up;
    if (fields.revealed_at !== undefined) set.revealedAt = when(fields.revealed_at) ?? null;
    if (fields.path !== undefined) set.path = toDbPath(fields.path);
    if (fields.mode !== undefined) set.mode = fields.mode;
    if (fields.base_sha !== undefined) set.baseSha = fields.base_sha;
    if (fields.ide_diff !== undefined) set.ideDiff = fields.ide_diff;
    if (fields.ide_submitted_at !== undefined) set.ideSubmittedAt = when(fields.ide_submitted_at) ?? null;
    const updated = await (await this.db()).update(lessons).set(set).where(eq(lessons.id, key)).returning({ id: lessons.id });
    if (!updated.length) throw new LessonNotFoundError(id);
    return (await this.get(id))!;
  }

  async saveStep(id: string, step: LessonStep): Promise<Lesson> {
    const key = await this.existing(id);
    const values = {
      answer: step.answer, grade: step.grade, done: step.done, hintLevel: step.hint_level,
      hintLevels: step.hints_used, hintsUsed: step.hints_used.length, updatedAt: when(step.updated_at) ?? new Date(),
    };
    await (await this.db()).insert(lessonSteps).values({ lessonId: key, step: step.step, ...values })
      .onConflictDoUpdate({ target: [lessonSteps.lessonId, lessonSteps.step], set: values });
    return (await this.get(id))!;
  }

  async appendMessage(id: string, message: LessonMessage): Promise<void> {
    const key = await this.existing(id);
    // ponytail: next seq computed in the insert; two writers racing on one
    // lesson hit the primary key and the second fails. One contributor, one
    // chat: retry or a sequence when that stops being true.
    await (await this.db()).insert(lessonMessages).values({
      lessonId: key, role: message.role, content: message.content, step: message.step, createdAt: when(message.at),
      seq: sql`(select coalesce(max(${lessonMessages.seq}), 0) + 1 from ${lessonMessages} where ${lessonMessages.lessonId} = ${key})`,
    });
  }

  async listMessages(id: string, limit = 50): Promise<LessonMessage[]> {
    const key = rowKey(id);
    if (!key || limit <= 0) return [];
    const rows = await (await this.db()).select().from(lessonMessages)
      .where(eq(lessonMessages.lessonId, key)).orderBy(desc(lessonMessages.seq)).limit(limit);
    return rows.reverse().map((m) => ({
      role: m.role === "user" ? "user" : "teacher", content: m.content,
      step: isStepId(m.step) ? m.step : null, at: m.createdAt.toISOString(),
    }));
  }
}

let shared: LessonStore | undefined;

/** The app's lesson store. */
export function lessonStore(): LessonStore {
  shared ??= new DbLessonStore(getDb);
  return shared;
}
