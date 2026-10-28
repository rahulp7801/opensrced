// s5 Questions: specific ones (the kickoff PDF's rule: no "I don't get it").
// Graded without a model: vague questions are bounced with an example of a
// good one; the teacher answers the specific ones Socratically.

import { StepInputError, wordsIn, type StepDef } from "./shared";

export const GOOD_QUESTION_EXAMPLE = "For example: \"When the response is a redirect, is the session cookie still written, and where is that decided?\"";

const VAGUE = /^(?:i\s+(?:don'?t|do not)\s+(?:get|understand)|how\s+(?:does|do)\s+(?:this|it|the\s+(?:code|project))\s+work|what\s+(?:do|should)\s+i\s+do|where\s+(?:do|should)\s+i\s+start|can\s+you\s+(?:explain|help)|what\s+is\s+(?:this|going\s+on)|any\s+(?:tips|hints|ideas))\b/i;
const MIN_WORDS = 6;

/** Why a question is too vague to work on, or null when it is specific enough. */
export function vagueReason(question: string): string | null {
  const q = question.trim();
  if (VAGUE.test(q)) return "it asks for everything at once";
  if (wordsIn(q) < MIN_WORDS) return "it is too short to say what you are stuck on";
  if (!/\?\s*$/.test(q) && !/^(?:why|how|what|when|where|which|who|is|are|does|do|can|should|would|will)\b/i.test(q)) return "it is not a question";
  return null;
}

export const s5: StepDef<string[]> = {
  id: "s5",
  title: "Your questions",
  question: "What do you want to know before you start? Ask specific questions, one per line.",
  hintQuestion: "Which part of the issue would you not be able to explain to someone else yet?",
  nudge: "Good questions name a behaviour, an input or a place: \"what happens when…\", \"why does … instead of …\".",
  needs: ["issue"],
  parseAnswer(raw) {
    if (typeof raw !== "string") throw new StepInputError("The answer must be text.");
    const questions = raw.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
    if (questions.length === 0) throw new StepInputError("Ask at least one question.");
    if (questions.length > 8 || questions.some((q) => q.length > 400)) throw new StepInputError("Keep it to at most 8 questions, each under 400 characters.");
    return questions;
  },
  grade(_ctx, questions) {
    const vague = questions.map((q) => ({ q, why: vagueReason(q) })).filter((v) => v.why);
    const passed = vague.length < questions.length;
    const feedback = vague.length === 0
      ? "Specific questions. Ask them in the teacher chat one at a time."
      : `${vague.length === questions.length ? "These are" : "Some are"} too vague (${vague.map((v) => `"${v.q.slice(0, 60)}": ${v.why}`).join("; ")}). ${GOOD_QUESTION_EXAMPLE}`;
    return { passed, feedback, detail: { vague: vague.map((v) => v.q) } };
  },
};
