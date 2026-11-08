// Lessons run from the harness (the plugin, harness/server.mjs): the site's
// lesson engine (lib/lesson/api.ts) with the same steps, grades, hints and
// stages, and three things swapped for what the contributor's machine has:
//
//   the answer key  their agent writes the hidden fix in a separate worktree
//                   and sends its diff (POST …/key), not a hidden cloud run
//   the context     the plugin sends the issue, the README and a code graph
//                   built from the checkout, so the server reads no GitHub
//   the grader      their agent: a step a model must judge comes back as a
//                   rubric, and the agent's verdict is parsed by the step's
//                   own parseGrade (POST …/answer with grader_reply)
//
// Lesson rows are the site's (lessons, lesson_steps), so the site can show
// progress; the extra context lives in harness_lesson_context.

import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { harnessLessonContext, lessons } from "./db/schema";
import type { GraphData } from "./graph";
import { MAX_DIFF_BYTES } from "./ide/lesson-api";
import { readJsonBody } from "./request-body";
import {
  createLesson, getLesson, lessonsEnabled, LESSONS_DISABLED, nextHint, publicLesson, revealLesson, saveIdeDiff,
  submitStep, updateLesson, type LessonDeps,
} from "./lesson/api";
import { DbLessonStore, rowKey } from "./lesson/db-store";
import { canSubmit, isGraded, isStepId, type AnswerKeyStatus } from "./lesson/machine";
import type { TeacherRuntime } from "./lesson/runtime";
import type { Lesson } from "./lesson/store";
import { PRACTICE_NEEDED } from "./lesson/steps/explain-it";
import { stepDef, StepInputError, type StepContext } from "./lesson/steps";

/** lessons.run_id for a lesson whose key comes from the contributor's agent. */
export const HARNESS_RUN = "harness";

export const ISSUE_TITLE_MAX = 500;
export const ISSUE_BODY_MAX = 20_000;
export const README_MAX = 200_000;
/** The graph arrives as graphify's graph.json (compacted), gzipped, in base64:
 *  pyjanitor's 4 MB is 0.4 MB that way. These caps bound a function's memory. */
export const GRAPH_GZ_MAX = 4_000_000;
export const GRAPH_MAX_BYTES = 64_000_000;
export const GRAPH_MAX_NODES = 250_000;
export const DIAGNOSIS_MAX = 4_000;
export const KEY_TITLE_MAX = 300;
/** Lesson creation carries the graph, so it may be large. */
const CREATE_BODY_MAX = GRAPH_GZ_MAX + README_MAX + ISSUE_BODY_MAX + 10_000;

export class HarnessLessonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessLessonInputError";
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function text(value: unknown, name: string, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new HarnessLessonInputError(`${name} must be text.`);
  if (value.length > max) throw new HarnessLessonInputError(`${name} must be under ${max} characters.`);
  return value;
}

/** graph_gz (gzipped JSON in base64) as a graph. Throws HarnessLessonInputError. */
export function unpackGraphGz(gz: string): GraphData {
  let raw: unknown;
  try { raw = JSON.parse(gunzipSync(Buffer.from(gz, "base64"), { maxOutputLength: GRAPH_MAX_BYTES }).toString("utf8")); }
  catch { throw new HarnessLessonInputError(`graph_gz must be gzipped graph JSON in base64, under ${GRAPH_MAX_BYTES} bytes unpacked.`); }
  return parseGraph(raw);
}

/** A code graph from the plugin, checked before it is stored or traversed.
 *  Throws HarnessLessonInputError. Pure. */
export function parseGraph(raw: unknown): GraphData {
  if (raw === undefined || raw === null) throw new HarnessLessonInputError("graph must be an object with nodes and links.");
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HarnessLessonInputError("graph must be an object with nodes and links.");
  const { nodes, links } = raw as { nodes?: unknown; links?: unknown };
  if (!Array.isArray(nodes) || !Array.isArray(links)) throw new HarnessLessonInputError("graph must have nodes and links arrays.");
  if (nodes.length > GRAPH_MAX_NODES) throw new HarnessLessonInputError(`graph must have at most ${GRAPH_MAX_NODES} nodes.`);
  const str = (v: unknown) => typeof v === "string" && v.length <= 1_000;
  for (const n of nodes) {
    const node = n as Record<string, unknown>;
    if (!node || !str(node.id) || !str(node.label) || typeof node.community !== "number" || (node.source_file !== undefined && node.source_file !== "" && !str(node.source_file))) {
      throw new HarnessLessonInputError("Each graph node needs an id, a label and a community number.");
    }
  }
  const ids = new Set(nodes.map((n) => (n as { id: string }).id));
  for (const l of links) {
    const link = l as Record<string, unknown>;
    if (!link || !str(link.source) || !str(link.target) || !str(link.relation) || !ids.has(link.source as string) || !ids.has(link.target as string)) {
      throw new HarnessLessonInputError("Each graph link needs a source and target node and a relation.");
    }
  }
  return { nodes, links } as GraphData;
}

type ContextRow = typeof harnessLessonContext.$inferSelect;

export function keyStatusOf(row: Pick<ContextRow, "keyDiff" | "keyVerified"> | null): AnswerKeyStatus {
  if (!row?.keyDiff) return "pending";
  return row.keyVerified ? "verified" : "unverified";
}

/** What the steps are graded against, from the stored row. Pure. */
export function contextOf(lesson: Lesson, row: ContextRow): StepContext {
  const status = keyStatusOf(row);
  return {
    repo: lesson.repo_url.replace(/^https:\/\/github\.com\//, ""),
    issue: { number: lesson.issue_number, title: row.issueTitle, body: row.issueBody },
    readme: row.readme,
    graph: row.graphGz ? unpackGraphGz(row.graphGz) : null,
    answerKey: row.keyDiff ? { diff: row.keyDiff, diagnosis: row.keyDiagnosis ?? "", cases: [], title: row.keyTitle ?? "" } : null,
    answerKeyStatus: status,
    // ponytail: the site's two practice review questions come from /api/understand,
    // which harness lessons don't use; the skill has the agent ask them in chat instead.
    practiced: PRACTICE_NEEDED,
    prefs: [],
  };
}

/** A grader that answers with the reply the contributor's agent already gave. */
export function echoRuntime(reply: string): TeacherRuntime {
  return {
    provider: "harness",
    send: () => new Response(`data: ${JSON.stringify({ text: reply })}\n\ndata: ${JSON.stringify({ cost: 0, done: true })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    }),
  };
}

async function contextRow(db: Db, lesson: Pick<Lesson, "id">): Promise<ContextRow | null> {
  const key = rowKey(lesson.id);
  if (!key) return null;
  const [row] = await db.select().from(harnessLessonContext).where(eq(harnessLessonContext.lessonId, key)).limit(1);
  return row ?? null;
}

/** The lesson engine's collaborators for one harness user. */
export function harnessDeps(db: Db, userId: string, graderReply: string | null = null): LessonDeps {
  const row = async (lesson: Lesson) => {
    const found = await contextRow(db, lesson);
    if (!found) throw new Error(`Lesson ${lesson.id} has no harness context.`);
    return found;
  };
  return {
    owner: async () => userId,
    store: new DbLessonStore(async () => db),
    startRun: async () => ({ id: HARNESS_RUN }),
    runState: async () => null,
    keyStatus: async (lesson) => keyStatusOf(await contextRow(db, lesson)),
    context: async (lesson) => contextOf(lesson, await row(lesson)),
    runtime: async () => (graderReply === null ? null : echoRuntime(graderReply)),
    // The key is the agent's own worktree: nothing to unlock on the server.
    reveal: async () => {},
  };
}

/** The caller's harness lesson, or the response to return. */
async function ownHarnessLesson(db: Db, userId: string, id: string): Promise<Lesson | Response> {
  if (!lessonsEnabled()) return json({ error: LESSONS_DISABLED }, 404);
  const lesson = await new DbLessonStore(async () => db).get(id).catch(() => null);
  return lesson && lesson.owner === userId && lesson.run_id === HARNESS_RUN ? lesson : json({ error: "not found" }, 404);
}

const relay = (body: unknown) => new Request("http://harness.local/", { method: "POST", body: JSON.stringify(body) });

// ── POST /api/harness/lessons ─────────────────────────────────────────────

/** {repo, issue, mode?, path?, issue_title, issue_body, readme, graph_gz?}:
 *  graph_gz is graphify's graph.json of the checkout, gzipped, in base64. */
export async function createHarnessLesson(req: Request, db: Db, userId: string): Promise<Response> {
  if (!lessonsEnabled()) return json({ error: LESSONS_DISABLED }, 404);
  const body = await readJsonBody<Record<string, unknown>>(req, CREATE_BODY_MAX);
  if (!body) return json({ error: `Send a JSON object under ${CREATE_BODY_MAX} bytes.` }, 400);
  let context: { issueTitle: string; issueBody: string; readme: string; graphGz: string | null };
  try {
    const graphGz = body.graph_gz === undefined ? null : text(body.graph_gz, "graph_gz", GRAPH_GZ_MAX);
    if (graphGz !== null) unpackGraphGz(graphGz); // checked now, unpacked again when a step needs it
    context = {
      issueTitle: text(body.issue_title, "issue_title", ISSUE_TITLE_MAX),
      issueBody: text(body.issue_body ?? "", "issue_body", ISSUE_BODY_MAX),
      readme: text(body.readme ?? "", "readme", README_MAX),
      graphGz,
    };
    if (!context.issueTitle.trim()) throw new HarnessLessonInputError("issue_title is required.");
  } catch (error) {
    if (error instanceof HarnessLessonInputError) return json({ error: error.message }, 400);
    throw error;
  }
  const repo = typeof body.repo === "string" ? body.repo : "";
  const created = await createLesson(relay({ repo_url: `https://github.com/${repo}`, issue_number: body.issue, mode: body.mode, path: body.path }), harnessDeps(db, userId));
  if (created.status !== 201) return created;
  const { lesson } = (await created.json()) as { lesson: { id: string } };
  try {
    await db.insert(harnessLessonContext).values({ lessonId: rowKey(lesson.id)!, ...context });
  } catch (error) {
    // A lesson without its context can't be graded: don't leave it behind.
    await db.delete(lessons).where(eq(lessons.id, rowKey(lesson.id)!)).catch(() => {});
    throw error;
  }
  return json({ lesson }, 201);
}

// ── GET /api/harness/lessons/<id> ─────────────────────────────────────────

/** The lesson, and after the reveal the key the agent sent. */
export async function getHarnessLesson(id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  if (own instanceof Response) return own;
  const res = await getLesson(id, harnessDeps(db, userId, ""));
  if (!res.ok || !own.revealed_at) return res;
  const row = await contextRow(db, own);
  const body = await res.json();
  return json({ ...body, key: row?.keyDiff ? { diff: row.keyDiff, diagnosis: row.keyDiagnosis ?? "", title: row.keyTitle ?? "" } : null });
}

// ── POST /api/harness/lessons/<id>/answer ─────────────────────────────────

/** {step, answer, grader_reply?}. A step a model must judge, sent without
 *  grader_reply, comes back as {needs_grading, rubric} and is not saved: the
 *  agent judges with the rubric and sends the answer again with its reply. */
export async function answerHarnessStep(req: Request, id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  if (own instanceof Response) return own;
  const body = await readJsonBody<Record<string, unknown>>(req, 100_000);
  if (!body) return json({ error: "Send a JSON object." }, 400);
  const { step, grader_reply: reply } = body;
  if (!isStepId(step)) return json({ error: "step must be one of the lesson's steps (s1…s10, explain-it)." }, 400);
  if (reply !== undefined && (typeof reply !== "string" || reply.length > 4_000)) return json({ error: "grader_reply must be the rubric's JSON, under 4000 characters." }, 400);
  if (!canSubmit(own.stage, step)) return json({ error: `This step is not open in the ${own.stage} stage.` }, 409);
  if (reply === undefined) {
    const def = stepDef(step);
    let answer: unknown;
    try { answer = def.parseAnswer(body.answer); }
    catch (error) {
      if (error instanceof StepInputError) return json({ error: error.message }, 400);
      throw error;
    }
    const ctx = await harnessDeps(db, userId).context(own);
    if (isGraded(step, ctx.answerKeyStatus) && def.grade(ctx, answer) === null && def.prompt) {
      return json({ needs_grading: true, step, rubric: def.prompt(ctx, answer) });
    }
  }
  return submitStep(relay({ answer: body.answer }), id, step, harnessDeps(db, userId, (reply as string | undefined) ?? null));
}

// ── POST /api/harness/lessons/<id>/key ────────────────────────────────────

/** {diff, diagnosis, title, verified}: the hidden fix from the agent's worktree.
 *  verified: its new test failed without the fix and passes with it. */
export async function setHarnessKey(req: Request, id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  if (own instanceof Response) return own;
  if (own.revealed_at) return json({ error: "The fix has been revealed; the key can't change now." }, 409);
  const body = await readJsonBody<Record<string, unknown>>(req, MAX_DIFF_BYTES + DIAGNOSIS_MAX + 10_000);
  if (!body) return json({ error: "Send a JSON object." }, 400);
  let key: { keyDiff: string; keyDiagnosis: string; keyTitle: string; keyVerified: boolean };
  try {
    const diff = text(body.diff, "diff", MAX_DIFF_BYTES);
    if (!/^\+\+\+ /m.test(diff)) throw new HarnessLessonInputError("diff must be a unified diff with at least one changed file.");
    if (typeof body.verified !== "boolean") throw new HarnessLessonInputError("verified must be true or false.");
    key = { keyDiff: diff, keyDiagnosis: text(body.diagnosis ?? "", "diagnosis", DIAGNOSIS_MAX), keyTitle: text(body.title ?? "", "title", KEY_TITLE_MAX), keyVerified: body.verified };
  } catch (error) {
    if (error instanceof HarnessLessonInputError) return json({ error: error.message }, 400);
    throw error;
  }
  await db.update(harnessLessonContext).set({ ...key, updatedAt: new Date() }).where(eq(harnessLessonContext.lessonId, rowKey(own.id)!));
  const updated = await new DbLessonStore(async () => db).updateStage(own.id, own.stage, { answer_key: keyStatusOf(key) });
  return json({ lesson: publicLesson(updated) });
}

// ── The rest, unchanged from the site ─────────────────────────────────────

export async function harnessHint(req: Request, id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  return own instanceof Response ? own : nextHint(req, id, harnessDeps(db, userId));
}

export async function harnessReveal(req: Request, id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  return own instanceof Response ? own : revealLesson(req, id, harnessDeps(db, userId));
}

/** Path B: the contributor's own diff from their checkout (submit: "I'm done"). */
export async function harnessOwnDiff(req: Request, id: string, db: Db, userId: string, submit: boolean): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  return own instanceof Response ? own : saveIdeDiff(req, id, harnessDeps(db, userId), submit);
}

export async function harnessUpdate(req: Request, id: string, db: Db, userId: string): Promise<Response> {
  const own = await ownHarnessLesson(db, userId, id);
  return own instanceof Response ? own : updateLesson(req, id, harnessDeps(db, userId));
}
