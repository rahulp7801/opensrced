// s10 Next steps: the contributor writes their own. Not graded; it feeds
// follow-ups (Phase 5). Next to it, the docs-first suggestion (PLAN §9.5
// item 4): "Was anything confusing to set up or understand? That's a first
// PR." The contributor's own kickoff questions and notes, turned into a docs
// issue they can copy and post themselves (opensrcer never posts it).

import { neutralizeMentions } from "../../agentic-pr";
import { clip, picks } from "../approach";
import { STEP_STAGE } from "../machine";
import type { Lesson, LessonMessage } from "../store";
import { textAnswer, type StepDef } from "./shared";

export const s10: StepDef<string> = {
  id: "s10",
  title: "Next steps",
  question: "What will you do next with this project? (Follow the PR, pick a related issue, read a part you now understand…)",
  hintQuestion: "Which part of the project would you like to understand better after this?",
  nudge: "Look at the issues labelled \"good first issue\" near the area you just worked in.",
  needs: [],
  parseAnswer: (raw) => textAnswer(raw, 1, 2000),
  grade: () => null,
};

export const DOCS_QUESTIONS_MAX = 5;
const PLACEHOLDER = "- (what was confusing to set up or understand, in a sentence)";

/** A docs issue from the kickoff: the questions the contributor asked (s5,
 *  and in the teacher chat during kickoff) and their research notes (s6),
 *  quoted, never rewritten. With no questions, a bullet to fill in. Pure. */
export function docsIssueDraft(lesson: Pick<Lesson, "issue_number" | "steps">, messages: LessonMessage[]): { title: string; body: string } {
  const asked = messages.filter((m) => m.role === "user" && m.step && STEP_STAGE[m.step] === "kickoff" && m.content.includes("?")).map((m) => m.content);
  const s5 = lesson.steps.s5?.answer ? picks(lesson.steps.s5.answer) : [];
  const seen = new Set<string>();
  const questions = [...s5, ...asked].map((q) => clip(q, 200)).filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, DOCS_QUESTIONS_MAX);
  const notes = lesson.steps.s6?.answer.trim();
  const body = [
    `While working on #${lesson.issue_number} as a first-time contributor, I found these hard to work out from the README and the docs:`,
    "",
    questions.length ? questions.map((q) => `- ${q}`).join("\n") : PLACEHOLDER,
    ...(notes ? ["", `What helped me in the end: ${clip(notes, 400)}`] : []),
    "",
    "A short section in the docs covering this would help the next newcomer. I'd be happy to open a PR for it.",
  ].join("\n");
  return { title: "Docs: what a newcomer found hard to understand", body: neutralizeMentions(body) };
}
