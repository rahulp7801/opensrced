// The lesson lifecycle (PLAN §7.1). Pure: which stage a lesson is in, which
// steps it asks for, which are graded, and when it may move on or reveal.
//
//   kickoff  s1 project → s2 resources → s3 libraries → s4 task → s5 questions → s6 research
//   locate   s7 three starting points     (graded only with a verified answer key)
//   predict  s8 the change and the test   (graded only with a verified answer key)
//   [path B] ide (§8): the contributor writes the fix
//   reveal   the AI's diff, next to their plan
//   explain  explain-it (stricter)
//   next     s10 next steps
//   done
//
// The hidden fix ("preparing" in the plan's diagram) runs alongside kickoff:
// it is the run's state (lib/hidden-runs.ts runPhase), not a lesson stage.
// Fork CI and publishing happen on the existing run page once explain-it
// has passed; they are not stages here.

export const STAGES = ["kickoff", "locate", "predict", "ide", "reveal", "explain", "next", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STEP_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "explain-it", "s10"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Short is the default for a first lesson; full follows the kickoff PDF. */
export type LessonMode = "short" | "full";
/** A: the AI's fix is revealed and explained. B: write it yourself (§8). */
export type LessonPath = "A" | "B";
/** `pending` while the hidden fix runs (§7.2). */
export type AnswerKeyStatus = "pending" | "verified" | "unverified" | "failed";

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

export const STEP_STAGE: Record<StepId, Stage> = {
  s1: "kickoff", s2: "kickoff", s3: "kickoff", s4: "kickoff", s5: "kickoff", s6: "kickoff",
  s7: "locate", s8: "predict", "explain-it": "explain", s10: "next",
};

const SHORT_KICKOFF: StepId[] = ["s1", "s4"];
const FULL_KICKOFF: StepId[] = ["s1", "s2", "s3", "s4", "s5", "s6"];

/** Steps the lesson needs done, in order. Short mode offers s2/s3/s5/s6 but
 *  does not wait for them. */
export function requiredSteps(mode: LessonMode): StepId[] {
  return [...(mode === "short" ? SHORT_KICKOFF : FULL_KICKOFF), "s7", "s8", "explain-it", "s10"];
}

/** Steps the contributor may submit in a stage (optional ones included). */
export function stepsInStage(stage: Stage): StepId[] {
  return STEP_IDS.filter((s) => STEP_STAGE[s] === stage);
}

/** Never graded: exposure (s2), notes that feed s7 (s6), and next steps (s10). */
const NEVER_GRADED = new Set<StepId>(["s2", "s6", "s10"]);
/** Graded only against a verified answer key (§7.2). */
const NEEDS_VERIFIED_KEY = new Set<StepId>(["s7", "s8"]);

/** Whether a submission of `step` gets a pass/fail. With an unverified or
 *  failed key, s7 and s8 become "let's investigate together": saved, not graded. */
export function isGraded(step: StepId, answerKey: AnswerKeyStatus): boolean {
  if (NEVER_GRADED.has(step)) return false;
  return !NEEDS_VERIFIED_KEY.has(step) || answerKey === "verified";
}

/** The stage after `stage` on this path. */
export function nextStageOf(stage: Stage, path: LessonPath): Stage {
  if (stage === "predict") return path === "B" ? "ide" : "reveal";
  if (stage === "ide") return "reveal";
  if (stage === "done") return "done";
  const following = STAGES[STAGES.indexOf(stage) + 1];
  return following === "ide" ? "reveal" : following;
}

/** Allowed stage changes: one step forward on the lesson's path, or the
 *  give-up jump to the reveal from any stage before it. */
export function canTransition(from: Stage, to: Stage, path: LessonPath, gaveUp = false): boolean {
  if (to === nextStageOf(from, path) && from !== "done") return true;
  return gaveUp && to === "reveal" && ["kickoff", "locate", "predict", "ide"].includes(from);
}

type StepsDone = Partial<Record<StepId, { done: boolean }>>;

/** Whether every required step of `stage` is done. Stages with no steps of
 *  their own (ide, reveal) are left by an explicit action, never by this. */
export function stageComplete(stage: Stage, mode: LessonMode, steps: StepsDone): boolean {
  const required = requiredSteps(mode).filter((s) => STEP_STAGE[s] === stage);
  return required.length > 0 && required.every((s) => steps[s]?.done === true);
}

/** Where a lesson stands after a step changes: it moves forward through
 *  every completed stage, stopping at the reveal (an action) and at done. */
export function advance(stage: Stage, mode: LessonMode, path: LessonPath, steps: StepsDone): Stage {
  let current = stage;
  while (current !== "done" && current !== "reveal" && current !== "ide" && stageComplete(current, mode, steps)) {
    current = nextStageOf(current, path);
  }
  return current;
}

/** May the contributor submit `step` now? Its stage must be the current one,
 *  except kickoff steps, which stay open (optional ones can be done late)
 *  until the reveal. */
export function canSubmit(stage: Stage, step: StepId): boolean {
  const own = STEP_STAGE[step];
  if (own === stage) return true;
  const beforeReveal = ["kickoff", "locate", "predict", "ide"].includes(stage);
  return own === "kickoff" && beforeReveal;
}

/** The reveal is allowed after s8 (the stage reached the reveal) or after an
 *  explicit give-up; never earlier (§7.2, §10.1). */
export function canReveal(stage: Stage, gaveUp: boolean): boolean {
  return stage === "reveal" || (gaveUp && ["kickoff", "locate", "predict", "ide"].includes(stage));
}
