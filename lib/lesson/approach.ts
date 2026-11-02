// "How I approached this" for the PR body (lib/publish.ts withApproach):
// a few bullets quoting only what the contributor wrote in their lesson,
// before any fix was revealed. Never the AI's text: no grades, no teacher
// replies, no explain-it (written after the reveal, next to the AI's diff).

import type { Lesson, LessonStore } from "./store";

/** Longest quote per bullet; cut at a sentence end when one fits. */
export const APPROACH_QUOTE_CHARS = 240;

export function clip(text: string, max = APPROACH_QUOTE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const sentence = head.search(/[.!?](?=\s)[^.!?]*$/);
  if (sentence >= max / 3) return head.slice(0, sentence + 1);
  return `${head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max).trimEnd()}…`;
}

/** A list answer as saved (s7 picks, s5 questions): a JSON array, or the raw lines of an older answer. */
export function picks(answer: string): string[] {
  try {
    const parsed: unknown = JSON.parse(answer);
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return answer.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
}

/** The bullets, from finished steps only: the task (s4), where they looked (s7)
 *  and the change they predicted (s8). Empty when none are done. Pure. */
export function approachBullets(lesson: Pick<Lesson, "steps">): string[] {
  const done = (id: "s4" | "s7" | "s8") => (lesson.steps[id]?.done && lesson.steps[id]?.answer.trim() ? lesson.steps[id]!.answer : null);
  const bullets: string[] = [];
  const task = done("s4");
  if (task) bullets.push(`The problem, as I understood it: ${clip(task)}`);
  const looked = done("s7");
  if (looked) bullets.push(`Where I started looking: ${clip(picks(looked).slice(0, 5).map((p) => `\`${p.replace(/`/g, "")}\``).join(", "))}`);
  const predicted = done("s8");
  if (predicted) bullets.push(`What I predicted before seeing any fix: ${clip(predicted)}`);
  return bullets;
}

/** The bullets for a run that is the owner's lesson's hidden fix; null when
 *  the run is not a lesson (or not theirs) or nothing is written yet. */
export async function approachForRun(store: LessonStore, owner: string, runId: string): Promise<string[] | null> {
  const lesson = await store.findByRun(runId);
  if (!lesson || lesson.owner !== owner) return null;
  const bullets = approachBullets(lesson);
  return bullets.length ? bullets : null;
}
