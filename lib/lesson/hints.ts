// The hint ladder (PLAN §7.5). Each "Hint" press shows the next level up:
//
//   0  a question             "What happens to the cookie when the response is a redirect?"
//   1  a nudge to the area    "Look at how responses are built for redirects."
//   2  a pointer: the file    "`src/flask/sessions.py` is worth a look."   (s7, s8; unlocks file names)
//   3  a partial reveal       "`save_session` decides … Read its first branch." (s8 only)
//
// Levels 2 and 3 come straight from the hidden diff, so they need no model
// and cannot say more than they mean to. Levels used are stored per step;
// they affect standing only lightly (§9.3), never as a penalty.

import type { StepId } from "./machine";
import type { LessonStep } from "./store";
import { hiddenDiffFacts } from "./leak";
import { stepDef } from "./steps";

/** The highest level each step offers. Only the location steps point at the fix. */
export function maxHintLevel(step: StepId): number {
  return step === "s8" ? 3 : step === "s7" ? 2 : 1;
}

/** The level the next press shows, or null when the ladder is used up. */
export function nextHintLevel(step: StepId, current: number): number | null {
  const next = Math.max(-1, current) + 1;
  return next <= maxHintLevel(step) ? next : null;
}

/** Where the fix is, for levels 1–3: the area (its folder), the file, and
 *  one symbol. Null without an answer key: then levels 2–3 fall back to the
 *  step's own nudge. */
export type HintFacts = { area: string | null; file: string | null; symbol: string | null };

export function hintFacts(diff: string | null): HintFacts {
  if (!diff) return { area: null, file: null, symbol: null };
  const facts = hiddenDiffFacts(diff);
  // The first non-test file is where the fix lives; tests are the proof.
  const file = facts.files.find((f) => !/(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.\w+$|(^|\/)test_[^/]+$/i.test(f)) ?? facts.files[0] ?? null;
  const area = file && file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/` : null;
  return { area, file, symbol: facts.symbols[0] ?? null };
}

/** The hint text for one level of one step. */
export function hintText(step: StepId, level: number, facts: HintFacts): string {
  const def = stepDef(step);
  if (level <= 0) return def.hintQuestion;
  if (level === 1) return facts.area && (step === "s7" || step === "s8") ? `Look around \`${facts.area}\`: what in there handles this behaviour?` : def.nudge;
  if (level === 2) return facts.file ? `\`${facts.file}\` is worth a look. What does it do on the path the issue describes?` : def.nudge;
  return facts.symbol ? `\`${facts.symbol}\` is where the behaviour is decided. Read it from the top: which branch runs for the issue's example?` : def.nudge;
}

/** The step's state after showing `level`. */
export function withHint(step: LessonStep, level: number, now = new Date()): LessonStep {
  return {
    ...step,
    hint_level: Math.max(step.hint_level, level),
    hints_used: step.hints_used.includes(level) ? step.hints_used : [...step.hints_used, level].sort((a, b) => a - b),
    updated_at: now.toISOString(),
  };
}

/** The generic hint that replaces a teacher reply which leaked twice (§7.3):
 *  the step's level-0 question, which names nothing. */
export function fallbackHint(step: StepId | null): string {
  return step ? `Let's take it one step at a time. ${stepDef(step).hintQuestion}` : "Let's take it one step at a time. What have you found so far, and what are you unsure about?";
}
