// Where lessons live (PLAN §2.3: `lessons`, `lesson_steps`, `lesson_messages`).
// The Postgres implementation arrives with lib/db; until then the routes use
// the in-memory one below, which is also what the tests use.

import { randomBytes } from "node:crypto";
import type { AnswerKeyStatus, LessonMode, LessonPath, Stage, StepId } from "./machine";

/** The grade a step got: the deterministic grader's or the model's, as parsed. */
export type StepGrade = { passed: boolean; feedback: string; detail?: unknown };

export type LessonStep = {
  step: StepId;
  /** The contributor's latest answer, as submitted. */
  answer: string;
  /** Null when the step is not graded (or not graded with this answer key). */
  grade: StepGrade | null;
  /** Done: passed, or submitted when the step is not graded. */
  done: boolean;
  /** Highest hint level shown for this step (-1: none), and every level used. */
  hint_level: number;
  hints_used: number[];
  updated_at: string;
};

export type Lesson = {
  id: string;
  /** Auth0 `sub`; every read is checked against the session user. */
  owner: string;
  repo_url: string;
  issue_number: number;
  /** The hidden fix (lib/hidden-runs.ts). */
  run_id: string;
  mode: LessonMode;
  path: LessonPath;
  stage: Stage;
  answer_key: AnswerKeyStatus;
  /** Teacher turns used (lib/lesson/budget.ts). */
  turns_used: number;
  gave_up?: boolean;
  revealed_at?: string;
  created_at: string;
  steps: Partial<Record<StepId, LessonStep>>;
};

export type LessonMessage = { role: "user" | "teacher"; content: string; step: StepId | null; at: string };

/** The fields updateStage may change alongside the stage. */
export type LessonUpdate = Partial<Pick<Lesson, "answer_key" | "turns_used" | "gave_up" | "revealed_at">>;

export class LessonNotFoundError extends Error {
  constructor(id: string) {
    super(`Lesson ${id} not found`);
    this.name = "LessonNotFoundError";
  }
}

export interface LessonStore {
  get(id: string): Promise<Lesson | null>;
  /** The lesson whose hidden fix is this run, or null. */
  findByRun(runId: string): Promise<Lesson | null>;
  create(lesson: Omit<Lesson, "id" | "created_at" | "steps" | "turns_used">): Promise<Lesson>;
  /** Throws LessonNotFoundError. */
  updateStage(id: string, stage: Stage, fields?: LessonUpdate): Promise<Lesson>;
  /** Throws LessonNotFoundError. */
  saveStep(id: string, step: LessonStep): Promise<Lesson>;
  /** Throws LessonNotFoundError. */
  appendMessage(id: string, message: LessonMessage): Promise<void>;
  /** The newest `limit` messages, oldest first. */
  listMessages(id: string, limit?: number): Promise<LessonMessage[]>;
}

export function newLessonId(): string {
  return `l_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

/** Process memory. Fine for tests and a single `next dev`; serverless
 *  instances do not share it, which is why lib/db replaces it. */
export class MemoryLessonStore implements LessonStore {
  private lessons = new Map<string, Lesson>();
  private messages = new Map<string, LessonMessage[]>();

  async get(id: string): Promise<Lesson | null> {
    const found = this.lessons.get(id);
    return found ? structuredClone(found) : null;
  }

  async findByRun(runId: string): Promise<Lesson | null> {
    for (const lesson of this.lessons.values()) if (lesson.run_id === runId) return structuredClone(lesson);
    return null;
  }

  async create(input: Omit<Lesson, "id" | "created_at" | "steps" | "turns_used">): Promise<Lesson> {
    const lesson: Lesson = { ...input, id: newLessonId(), created_at: new Date().toISOString(), steps: {}, turns_used: 0 };
    this.lessons.set(lesson.id, lesson);
    this.messages.set(lesson.id, []);
    return structuredClone(lesson);
  }

  private mutate(id: string, change: (lesson: Lesson) => Lesson): Lesson {
    const current = this.lessons.get(id);
    if (!current) throw new LessonNotFoundError(id);
    const next = change(current);
    this.lessons.set(id, next);
    return structuredClone(next);
  }

  async updateStage(id: string, stage: Stage, fields: LessonUpdate = {}): Promise<Lesson> {
    return this.mutate(id, (lesson) => ({ ...lesson, ...fields, stage }));
  }

  async saveStep(id: string, step: LessonStep): Promise<Lesson> {
    return this.mutate(id, (lesson) => ({ ...lesson, steps: { ...lesson.steps, [step.step]: structuredClone(step) } }));
  }

  async appendMessage(id: string, message: LessonMessage): Promise<void> {
    const list = this.messages.get(id);
    if (!list) throw new LessonNotFoundError(id);
    list.push({ ...message });
  }

  async listMessages(id: string, limit = 50): Promise<LessonMessage[]> {
    if (limit <= 0) return [];
    return (this.messages.get(id) ?? []).slice(-limit).map((m) => ({ ...m }));
  }
}

// ponytail: one process-wide store until lib/db's implementation is wired in at merge.
let shared: LessonStore | undefined;
export function lessonStore(): LessonStore {
  shared ??= new MemoryLessonStore();
  return shared;
}
