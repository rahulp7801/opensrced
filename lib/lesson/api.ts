// The lesson API (PLAN §7), behind OPENSRCER_LESSONS=1. The routes under
// app/api/lessons are one line each; the handlers live here with their
// collaborators passed in, so tests drive them without Next or the network.
//
//   POST /api/lessons                       create, starting the hidden run
//   GET  /api/lessons/<id>                  the lesson: stage, steps, grades
//   GET  /api/lessons/<id>/status           the hidden run's phase, nothing else
//   POST /api/lessons/<id>/steps/<step>     submit an answer and grade it
//   POST /api/lessons/<id>/teacher          one teacher reply (SSE), leak-checked
//   POST /api/lessons/<id>/hint             the next hint for a step
//   POST /api/lessons/<id>/reveal           after s8 or an explicit give-up
//   PATCH /api/lessons/<id>                 change path (until s8) or mode (in kickoff)
//   POST /api/lessons/<id>/ask              IDE "ask about selection" (teacher, leak-checked)
//   POST /api/lessons/<id>/suggest          IDE Ctrl+I (teacher, leak-checked)
//   POST /api/lessons/<id>/checkpoint       IDE diff, saved every 30 s
//   POST /api/lessons/<id>/submit           IDE "I'm done": the diff the reveal compares
//
// Every handler answers "not yours" like "missing" (404).

import { readJsonBody } from "../request-body";
import { parseRunTarget } from "../run-target";
import { RUN_PHASE_LABEL, runPhase } from "../hidden-runs";
import { MAX_DIFF_BYTES, MAX_SELECTION_CHARS } from "../ide/lesson-api";
import { validSha } from "../ide/repo-tree";
import { ReplyFormatError } from "../understanding";
import { assertTurnsLeft, budgetState, TurnBudgetError, type TeacherProvider, type Env } from "./budget";
import { hintFacts, hintText, maxHintLevel, nextHintLevel, withHint } from "./hints";
import { checkLeak, type LeakGate } from "./leak";
import {
  advance, canReveal, canSubmit, isGraded, isStepId, requiredSteps, stepsInStage,
  type AnswerKeyStatus, type StepId,
} from "./machine";
import { complete, TEACHER_UNAVAILABLE, type TeacherRuntime } from "./runtime";
import { LESSON_ID_RE, type Lesson, type LessonStep, type LessonStore, type StepGrade } from "./store";
import { stepDef, StepInputError, type StepContext } from "./steps";
import { guardedReply, HISTORY_TURNS, lessonNote, teacherMessages, teacherSystem } from "./teacher";

export const LESSONS_DISABLED = "Lessons are not enabled on this deployment.";
export const MESSAGE_MAX = 2000;
const GRADER_MAX_TOKENS = 500;

export function lessonsEnabled(env: Env = process.env): boolean {
  return env.OPENSRCER_LESSONS === "1";
}

export type LessonDeps = {
  /** The signed-in user, or null. */
  owner: () => Promise<string | null>;
  store: LessonStore;
  /** Start the hidden run (lib/run-start.ts startIssueRun with hidden: true). */
  startRun: (input: { repoUrl: string; issueNumber: number; owner: string; signal: AbortSignal }) => Promise<{ id: string }>;
  /** The run's status and log, owner-scoped; null when missing. */
  runState: (owner: string, runId: string) => Promise<{ status: string; log: string } | null>;
  /** The answer key's status right now (lib/lesson/context.ts answerKeyStatus). */
  keyStatus: (lesson: Lesson) => Promise<AnswerKeyStatus>;
  context: (lesson: Lesson) => Promise<StepContext>;
  /** The teacher engine for this user, or null (TEACHER_UNAVAILABLE). */
  runtime: () => Promise<TeacherRuntime | null>;
  /** Set the hidden run's reveal marker (lib/hidden-runs.ts revealHiddenRun). */
  reveal: (owner: string, runId: string) => Promise<void>;
  /** The default branch's commit now (owner/name), pinned for the code viewer and the IDE. */
  headSha?: (repo: string, signal: AbortSignal) => Promise<string>;
  log?: (line: string) => void;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => json({ error: "not found" }, 404);

/** The caller's lesson, or the response to return. */
async function ownLesson(deps: LessonDeps, id: string): Promise<{ owner: string; lesson: Lesson } | Response> {
  if (!lessonsEnabled()) return json({ error: LESSONS_DISABLED }, 404);
  const owner = await deps.owner();
  if (!owner) return json({ error: "Not authenticated" }, 401);
  if (!LESSON_ID_RE.test(id)) return notFound();
  const lesson = await deps.store.get(id);
  return lesson && lesson.owner === owner ? { owner, lesson } : notFound();
}

/** What the browser may see: everything but the run's content. Grades were
 *  leak-checked when they were made. */
export function publicLesson(lesson: Lesson, provider: TeacherProvider | null = null) {
  const visible = new Set([...stepsInStage(lesson.stage), ...requiredSteps(lesson.mode), "s2", "s3", "s5", "s6"]);
  return {
    id: lesson.id, repo_url: lesson.repo_url, issue_number: lesson.issue_number, run_id: lesson.run_id,
    mode: lesson.mode, path: lesson.path, stage: lesson.stage, answer_key: lesson.answer_key,
    revealed: Boolean(lesson.revealed_at), gave_up: lesson.gave_up === true, created_at: lesson.created_at,
    required: requiredSteps(lesson.mode),
    base_sha: lesson.base_sha ?? null,
    ide_submitted: Boolean(lesson.ide_submitted_at),
    // The contributor's own diff, for the reveal's comparison; the IDE keeps its own copy before that.
    ...(lesson.revealed_at ? { ide_diff: lesson.ide_diff ?? "" } : {}),
    steps: [...visible].filter(isStepId).map((id) => {
      const def = stepDef(id);
      const saved = lesson.steps[id];
      return {
        id, title: def.title, question: def.question, done: saved?.done ?? false, grade: saved?.grade ?? null,
        hint_level: saved?.hint_level ?? -1, max_hint_level: maxHintLevel(id), answer: saved?.answer ?? "",
      };
    }),
    turns: provider ? budgetState(provider, lesson.turns_used) : { used: lesson.turns_used },
  };
}

/** Which names the leak check still hides, from the lesson record. */
export function leakGate(lesson: Lesson): LeakGate {
  return {
    stage: lesson.stage, revealed: Boolean(lesson.revealed_at),
    s7HintLevel: lesson.steps.s7?.hint_level ?? -1, s8HintLevel: lesson.steps.s8?.hint_level ?? -1,
    s7Done: lesson.steps.s7?.done === true,
  };
}

/** Everything the contributor has written in this lesson: names they used
 *  first are theirs to discuss (lib/lesson/leak.ts). */
async function contributorText(deps: LessonDeps, lesson: Lesson, extra = ""): Promise<string> {
  const messages = await deps.store.listMessages(lesson.id, 200);
  return [...Object.values(lesson.steps).map((s) => s?.answer ?? ""), ...messages.filter((m) => m.role === "user").map((m) => m.content), extra].join("\n");
}

// ── POST /api/lessons ─────────────────────────────────────────────────────

export async function createLesson(req: Request, deps: LessonDeps): Promise<Response> {
  if (!lessonsEnabled()) return json({ error: LESSONS_DISABLED }, 404);
  const owner = await deps.owner();
  if (!owner) return json({ error: "Not authenticated" }, 401);
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body) return json({ error: "Send a JSON object." }, 400);
  let target: ReturnType<typeof parseRunTarget>;
  try { target = parseRunTarget(typeof body.repo_url === "string" ? body.repo_url : undefined); }
  catch { return json({ error: "Invalid GitHub repository URL" }, 400); }
  const issue = body.issue_number ?? target.issue;
  if (typeof issue !== "number" || !Number.isSafeInteger(issue) || issue < 1) return json({ error: "issue_number must be a positive whole number, or use an issue URL." }, 400);
  if (target.issue !== undefined && issue !== target.issue) return json({ error: `The URL points at issue #${target.issue} but issue_number is ${issue}.` }, 400);
  // Short mode is the default for a first lesson (§7.1); path A unless asked,
  // and the lesson page offers both until s8 (PATCH below).
  const mode = body.mode ?? "short";
  const path = body.path ?? "A";
  if (mode !== "short" && mode !== "full") return json({ error: 'mode must be "short" or "full".' }, 400);
  if (path !== "A" && path !== "B") return json({ error: 'path must be "A" or "B".' }, 400);
  const repoUrl = `https://github.com/${target.repo}`;
  // Same pipeline, guards and verification as any run; only hidden (§7.2).
  let run: { id: string };
  try { run = await deps.startRun({ repoUrl, issueNumber: issue, owner, signal: req.signal }); }
  catch (error) {
    // RunStartError (lib/run-start.ts) carries a status and a message safe to show.
    const status = (error as { status?: unknown }).status;
    if (error instanceof Error && typeof status === "number") return json({ error: error.message }, status);
    throw error;
  }
  const lesson = await deps.store.create({ owner, repo_url: repoUrl, issue_number: issue, run_id: run.id, mode, path, stage: "kickoff", answer_key: "pending" });
  return json({ lesson: publicLesson(lesson) }, 201);
}

// ── GET /api/lessons/<id> ─────────────────────────────────────────────────

export async function getLesson(id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  let lesson = found.lesson;
  // The hidden fix finishes while the contributor works on kickoff.
  if (lesson.answer_key === "pending") {
    const status = await deps.keyStatus(lesson);
    if (status !== "pending") lesson = await deps.store.updateStage(lesson.id, lesson.stage, { answer_key: status });
  }
  // Pin the commit the code viewer and the IDE show, once. A failed lookup
  // leaves it unpinned (the viewer says so) and is retried on the next read.
  if (!lesson.base_sha && deps.headSha) {
    let sha: string | null = null;
    try { sha = await deps.headSha(parseRunTarget(lesson.repo_url).repo, AbortSignal.timeout(10_000)); }
    catch (error) { (deps.log ?? console.warn)(`[lesson] could not pin a commit: ${error instanceof Error ? error.message : String(error)}`); }
    if (validSha(sha)) lesson = await deps.store.updateStage(lesson.id, lesson.stage, { base_sha: sha.toLowerCase() });
  }
  const [runtime, messages] = await Promise.all([deps.runtime(), deps.store.listMessages(lesson.id, 50)]);
  return json({ lesson: publicLesson(lesson, runtime?.provider ?? null), teacher_available: Boolean(runtime), messages });
}

// ── PATCH /api/lessons/<id> ───────────────────────────────────────────────

/** The path can change until s8 is done (the stage moves past predict); the
 *  mode only during kickoff, since it decides which kickoff steps count. */
export async function updateLesson(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const { lesson } = found;
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body) return json({ error: "Send a JSON object." }, 400);
  const { path, mode } = body;
  if (path === undefined && mode === undefined) return json({ error: "Send path and/or mode." }, 400);
  if (path !== undefined && path !== "A" && path !== "B") return json({ error: 'path must be "A" or "B".' }, 400);
  if (mode !== undefined && mode !== "short" && mode !== "full") return json({ error: 'mode must be "short" or "full".' }, 400);
  if (path !== undefined && path !== lesson.path && (lesson.revealed_at || !["kickoff", "locate", "predict"].includes(lesson.stage))) {
    return json({ error: "The path can only change until you finish predicting the change (s8)." }, 409);
  }
  if (mode !== undefined && mode !== lesson.mode && lesson.stage !== "kickoff") return json({ error: "The mode can only change during the kickoff steps." }, 409);
  const next = { path: (path ?? lesson.path) as Lesson["path"], mode: (mode ?? lesson.mode) as Lesson["mode"] };
  // Short mode may already have everything it needs.
  const stage = advance(lesson.stage, next.mode, next.path, lesson.steps);
  const updated = await deps.store.updateStage(lesson.id, stage, next);
  return json({ lesson: publicLesson(updated) });
}

// ── GET /api/lessons/<id>/status ──────────────────────────────────────────

/** Progress only: a fixed phase and label, never text from the log. */
export async function lessonStatus(id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const run = await deps.runState(found.owner, found.lesson.run_id);
  if (!run) return json({ phase: "failed", label: RUN_PHASE_LABEL.failed });
  const phase = runPhase(run, run.log);
  return json({ phase, label: RUN_PHASE_LABEL[phase] });
}

// ── POST /api/lessons/<id>/steps/<step> ───────────────────────────────────

/** One grader call, retried once on an unusable reply (as lib/understanding.ts does). */
async function modelGrade(runtime: TeacherRuntime, prompt: { system: string; user: string }, parse: (reply: string) => StepGrade, signal: AbortSignal, log: (line: string) => void): Promise<{ grade: StepGrade | null; calls: number }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await complete(runtime, [{ role: "user", content: prompt.user }], { system: prompt.system, tier: "grader", maxTokens: GRADER_MAX_TOKENS, signal });
    log(`[lesson] grader call ${attempt}: cost $${reply.cost.toFixed(4)}`);
    try { return { grade: parse(reply.text), calls: attempt }; }
    catch (error) {
      if (!(error instanceof ReplyFormatError)) throw error;
      log(`[lesson] grader attempt ${attempt} returned unusable JSON: ${error.message}`);
    }
  }
  return { grade: null, calls: 2 };
}

export const GRADED_QUIETLY = "Checked. Ask the teacher what to look at next.";

export async function submitStep(req: Request, id: string, stepParam: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const { lesson } = found;
  const log = deps.log ?? console.warn;
  if (!isStepId(stepParam)) return notFound();
  const step: StepId = stepParam;
  if (!canSubmit(lesson.stage, step)) return json({ error: `This step is not open in the ${lesson.stage} stage.` }, 409);
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body) return json({ error: "Send a JSON object." }, 400);
  const def = stepDef(step);
  let answer: unknown;
  try { answer = def.parseAnswer(body.answer); }
  catch (error) {
    if (error instanceof StepInputError) return json({ error: error.message }, 400);
    throw error;
  }

  const ctx = await deps.context(lesson);
  let grade: StepGrade | null = null;
  let calls = 0;
  if (isGraded(step, ctx.answerKeyStatus)) {
    grade = def.grade(ctx, answer);
    if (!grade && def.prompt && def.parseGrade) {
      const runtime = await deps.runtime();
      if (!runtime) return json({ error: TEACHER_UNAVAILABLE }, 409);
      try { assertTurnsLeft(runtime.provider, lesson.turns_used, 2); }
      catch (error) {
        if (error instanceof TurnBudgetError) return json({ error: error.message }, 429);
        throw error;
      }
      let result: { grade: StepGrade | null; calls: number };
      try { result = await modelGrade(runtime, def.prompt(ctx, answer), (reply) => def.parseGrade!(reply, answer), req.signal, log); }
      catch (error) {
        return json({ error: error instanceof Error ? error.message : "The check could not run." }, 502);
      }
      calls = result.calls;
      if (!result.grade) {
        await deps.store.updateStage(lesson.id, lesson.stage, { turns_used: lesson.turns_used + calls });
        return json({ error: "The grader did not return a usable answer. Please retry." }, 502);
      }
      grade = result.grade;
    }
  }
  // A grader can slip; its feedback goes through the same leak check as the teacher.
  if (grade && ctx.answerKey) {
    const leak = checkLeak(grade.feedback, ctx.answerKey.diff, leakGate(lesson), await contributorText(deps, lesson, JSON.stringify(answer)));
    if (leak.leak) {
      log(`[lesson] grader feedback replaced: ${leak.reasons.join(" | ").slice(0, 300)}`);
      grade = { ...grade, feedback: GRADED_QUIETLY };
    }
  }

  const previous = lesson.steps[step];
  const saved: LessonStep = {
    step, answer: typeof answer === "string" ? answer : JSON.stringify(answer), grade,
    // Not graded (or not with this key): done once submitted.
    done: grade ? grade.passed : true,
    hint_level: previous?.hint_level ?? -1, hints_used: previous?.hints_used ?? [], updated_at: new Date().toISOString(),
  };
  const withStep = await deps.store.saveStep(lesson.id, saved);
  const stage = advance(withStep.stage, withStep.mode, withStep.path, withStep.steps);
  const updated = await deps.store.updateStage(lesson.id, stage, { answer_key: ctx.answerKeyStatus, turns_used: lesson.turns_used + calls });
  return json({ step: { id: step, done: saved.done, grade }, lesson: publicLesson(updated) });
}

// ── POST /api/lessons/<id>/hint ───────────────────────────────────────────

export async function nextHint(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const { lesson } = found;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const step = body?.step;
  if (!isStepId(step)) return json({ error: "Name the step the hint is for." }, 400);
  if (!canSubmit(lesson.stage, step)) return json({ error: `This step is not open in the ${lesson.stage} stage.` }, 409);
  const current = lesson.steps[step] ?? { step, answer: "", grade: null, done: false, hint_level: -1, hints_used: [], updated_at: new Date().toISOString() };
  const level = nextHintLevel(step, current.hint_level);
  if (level === null) return json({ error: "That was the last hint for this step. Ask the teacher, or give up and reveal the fix." }, 409);
  // Levels 1–3 point toward the fix, so they come from the hidden diff itself.
  const ctx = level >= 1 ? await deps.context(lesson) : null;
  const text = hintText(step, level, hintFacts(ctx?.answerKey?.diff ?? null));
  await deps.store.saveStep(lesson.id, withHint(current, level));
  return json({ step, level, text });
}

// ── POST /api/lessons/<id>/teacher ────────────────────────────────────────

export async function teacherTurn(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const body = await readJsonBody<Record<string, unknown>>(req);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MESSAGE_MAX) return json({ error: `Write a message of up to ${MESSAGE_MAX} characters.` }, 400);
  const step = body?.step === undefined || body.step === null ? null : body.step;
  if (step !== null && !isStepId(step)) return json({ error: "Unknown step." }, 400);
  const reply = await teacherExchange(found.lesson, message, step, req.signal, deps);
  if (reply instanceof Response) return reply;
  // The reply is complete and checked before the first byte goes out: a
  // streamed token could not be taken back if the check then failed.
  const events = [{ text: reply.text }, { done: true, turns_left: reply.turnsLeft }];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}

/** One leak-checked teacher reply to `message`, saved to the lesson's
 *  history; or the error response. Shared by the lesson chat and the IDE. */
async function teacherExchange(lesson: Lesson, message: string, step: StepId | null, signal: AbortSignal, deps: LessonDeps): Promise<{ text: string; turnsLeft: number } | Response> {
  const runtime = await deps.runtime();
  if (!runtime) return json({ error: TEACHER_UNAVAILABLE }, 409);
  let budget;
  try { budget = assertTurnsLeft(runtime.provider, lesson.turns_used, 1); }
  catch (error) {
    if (error instanceof TurnBudgetError) return json({ error: error.message }, 429);
    throw error;
  }

  const ctx = await deps.context(lesson);
  const history = (await deps.store.listMessages(lesson.id, HISTORY_TURNS)).map((m) => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content }));
  const gate = leakGate(lesson);
  const note = lessonNote({ stage: lesson.stage, step, gate, budget, hintLevel: step ? lesson.steps[step]?.hint_level ?? -1 : -1 });
  let reply;
  try {
    reply = await guardedReply(runtime, {
      system: teacherSystem(ctx), messages: teacherMessages([...history, { role: "user", content: message }], note),
      diff: ctx.answerKey?.diff ?? null, gate, contributorText: await contributorText(deps, lesson, message),
      step, signal, log: deps.log,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The teacher could not answer." }, 502);
  }
  // Counts only: the reasons name the fix (guardedReply logs them when it replaces a reply).
  (deps.log ?? console.warn)(`[teacher] leak check: ${reply.leaks.length} flagged, ${reply.replaced ? "replaced with a generic hint" : "sent"}, cost $${reply.cost.toFixed(4)}`);
  const at = new Date().toISOString();
  await deps.store.appendMessage(lesson.id, { role: "user", content: message, step, at });
  await deps.store.appendMessage(lesson.id, { role: "teacher", content: reply.text, step, at });
  await deps.store.updateStage(lesson.id, lesson.stage, { turns_used: lesson.turns_used + reply.calls });
  return { text: reply.text, turnsLeft: budgetState(runtime.provider, lesson.turns_used + reply.calls).left };
}

// ── The IDE's teacher: POST /api/lessons/<id>/ask and /suggest ─────────────

/** "Ask about selection": the question with the selected code, as one
 *  teacher turn (leak-checked, saved with the lesson chat). */
export async function askAboutSelection(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const body = await readJsonBody<Record<string, unknown>>(req, 100_000);
  const { selection, file, question } = body ?? {};
  if (typeof selection !== "string" || typeof file !== "string" || selection.length > MAX_SELECTION_CHARS || file.length > 1_000
    || (question !== undefined && (typeof question !== "string" || question.length > MESSAGE_MAX))) {
    return json({ error: "Expected { selection: string, file: string, question?: string }" }, 400);
  }
  const asked = (question as string | undefined)?.trim() || "What does this code do?";
  const message = selection.trim() ? `${asked}\n\nIn ${file || "the editor"}:\n\`\`\`\n${selection}\n\`\`\`` : asked;
  const reply = await teacherExchange(found.lesson, message, null, req.signal, deps);
  return reply instanceof Response ? reply : json({ reply: reply.text, turns_left: reply.turnsLeft });
}

/** Ctrl+I "Suggest" (PLAN §8.3): a nudge for the line the cursor is on, from
 *  the teacher, so it passes the same leak check as every other reply. */
export async function suggestAtCursor(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const body = await readJsonBody<Record<string, unknown>>(req, 10_000);
  const { file, line } = body ?? {};
  if (typeof file !== "string" || !file || file.length > 1_000 || !Number.isSafeInteger(line) || (line as number) < 1) {
    return json({ error: "Expected { file: string, line: number }" }, 400);
  }
  const message = `I'm editing ${file} at line ${line}. What should I think about writing here? Give me a hint, not the code.`;
  const reply = await teacherExchange(found.lesson, message, null, req.signal, deps);
  return reply instanceof Response ? reply : json({ suggestion: reply.text, turns_left: reply.turnsLeft });
}

// ── POST /api/lessons/<id>/checkpoint and /submit (path B) ────────────────

/** The IDE's diff: saved every 30 s (checkpoint), or submitted with "I'm
 *  done, check my work". Frozen once the fix is revealed, so the reveal
 *  compares what was written before seeing the AI's version. */
export async function saveIdeDiff(req: Request, id: string, deps: LessonDeps, submit: boolean): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const { lesson } = found;
  const body = await readJsonBody<Record<string, unknown>>(req, MAX_DIFF_BYTES + 1_000);
  const diff = body?.diff;
  if (typeof diff !== "string" || diff.length > MAX_DIFF_BYTES) return json({ error: "Expected { diff: string } under 1 MB" }, 400);
  if (lesson.revealed_at) return json({ error: "The fix has been revealed; your diff is kept as it was." }, 409);
  if (!submit) {
    const saved = await deps.store.updateStage(lesson.id, lesson.stage, { ide_diff: diff });
    return json({ ok: true, savedAt: new Date().toISOString(), bytes: diff.length, submitted: Boolean(saved.ide_submitted_at) });
  }
  if (lesson.path !== "B") return json({ error: "Switch the lesson to \"write it yourself\" first." }, 409);
  if (!diff.trim()) return json({ error: "There are no changes to check yet." }, 400);
  // From the IDE stage this is the action that leads to the reveal (lib/lesson/machine.ts).
  const stage = lesson.stage === "ide" ? "reveal" : lesson.stage;
  const updated = await deps.store.updateStage(lesson.id, stage, { ide_diff: diff, ide_submitted_at: new Date().toISOString() });
  return json({ lesson: publicLesson(updated) });
}

// ── POST /api/lessons/<id>/reveal ─────────────────────────────────────────

export async function revealLesson(req: Request, id: string, deps: LessonDeps): Promise<Response> {
  const found = await ownLesson(deps, id);
  if (found instanceof Response) return found;
  const { owner, lesson } = found;
  if (lesson.revealed_at) return json({ lesson: publicLesson(lesson) });
  const body = await readJsonBody<Record<string, unknown>>(req);
  const giveUp = body?.give_up === true;
  // Only after s8, or when the contributor explicitly gives up (§7.2).
  if (!canReveal(lesson.stage, giveUp)) return json({ error: "Finish predicting the change (s8) first, or choose to give up and see the fix." }, 409);
  const status = await deps.keyStatus(lesson);
  if (status === "pending") return json({ error: "The hidden fix is still running. Keep going; it will be ready soon." }, 409);
  if (status === "failed") return json({ error: "The hidden fix did not finish, so there is nothing to reveal. Your own plan stands." }, 409);
  await deps.reveal(owner, lesson.run_id);
  const updated = await deps.store.updateStage(lesson.id, "explain", { revealed_at: new Date().toISOString(), answer_key: status, ...(giveUp ? { gave_up: true } : {}) });
  // The diff now loads from GET /api/dispatches/<run_id>/preview, which the reveal unlocked.
  return json({ lesson: publicLesson(updated) });
}
