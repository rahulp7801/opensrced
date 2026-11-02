import { test } from "node:test";
import assert from "node:assert/strict";
import { docsIssueDraft, DOCS_QUESTIONS_MAX, s10 } from "../lesson/steps/s10";
import type { LessonMessage } from "../lesson/store";
import { stepDef, StepInputError } from "../lesson/steps";
import { isGraded, STEP_IDS } from "../lesson/machine";

test("s10 keeps the contributor's next steps, ungraded", () => {
  assert.equal(s10.parseAnswer("Watch the PR, then try #812."), "Watch the PR, then try #812.");
  assert.throws(() => s10.parseAnswer(" "), StepInputError);
  assert.equal(isGraded("s10", "verified"), false);
});

test("every step id has a definition with a question and hints", () => {
  for (const id of STEP_IDS) {
    const def = stepDef(id);
    assert.equal(def.id, id);
    assert.ok(def.question && def.hintQuestion && def.nudge, id);
    // A model-graded step has both halves; the rest have neither.
    assert.equal(Boolean(def.prompt), Boolean(def.parseGrade), id);
  }
});

const msg = (content: string, step: LessonMessage["step"], role: LessonMessage["role"] = "user"): LessonMessage => ({ role, content, step, at: "t" });
const saved = (step: "s5" | "s6", answer: string) => ({ step, answer, grade: null, done: true, hint_level: -1, hints_used: [], updated_at: "t" });

test("docsIssueDraft: the kickoff questions (s5, then the chat), deduped, plus the research notes; mentions defused", () => {
  const draft = docsIssueDraft(
    { issue_number: 7, steps: { s5: saved("s5", JSON.stringify(["How do I run only the session tests?", "Why is there a second config file?"])), s6: saved("s6", "The testing guide by @maintainer explained tox.") } },
    [
      msg("how do I run only the session tests?", "s1"),
      msg("Which Python versions are supported?", "s4"),
      msg("What does save mean here?", "s8"),
      msg("That makes sense now.", "s1"),
      msg("Is this the right file?", null),
      msg("A teacher question?", "s1", "teacher"),
    ],
  );
  assert.equal(draft.title, "Docs: what a newcomer found hard to understand");
  assert.equal(draft.body, [
    "While working on #7 as a first-time contributor, I found these hard to work out from the README and the docs:",
    "",
    "- How do I run only the session tests?\n- Why is there a second config file?\n- Which Python versions are supported?",
    "",
    "What helped me in the end: The testing guide by @\u200bmaintainer explained tox.",
    "",
    "A short section in the docs covering this would help the next newcomer. I'd be happy to open a PR for it.",
  ].join("\n"));
});

test("docsIssueDraft: with no questions, a bullet to fill in; at most five questions", () => {
  assert.match(docsIssueDraft({ issue_number: 1, steps: {} }, []).body, /\n- \(what was confusing to set up or understand, in a sentence\)\n/);
  const many = Array.from({ length: 9 }, (_, i) => msg(`Question number ${i}?`, "s1"));
  assert.equal(docsIssueDraft({ issue_number: 1, steps: {} }, many).body.match(/^- /gm)!.length, DOCS_QUESTIONS_MAX);
});
