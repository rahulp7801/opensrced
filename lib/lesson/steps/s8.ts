// s8 Predict the change and the test. Graded by the fast model against the
// hidden diff, its test cases and diagnosis, on three parts: the cause
// (where), the change (what), the proof (a test idea). Pass = the cause plus
// one of the other two. A different fix that would also work is accepted, and
// the grader must say so. Only graded with a verified answer key.

import { jsonObject, looksCopied, replyBool, replyText } from "../../understanding";
import { fence, GRADER_UNTRUSTED, issueBlock, JSON_ONLY, textAnswer, type StepDef } from "./shared";

export const s8: StepDef<string> = {
  id: "s8",
  title: "Predict the change and the test",
  question: "What would you change, where, and why? And what test would prove it works (and fail without your change)?",
  hintQuestion: "What is the smallest change that makes the issue's example behave as expected? What input would a test use?",
  nudge: "Write the test first in words: \"given …, when …, then …\". The change is whatever makes that pass.",
  needs: ["issue", "answerKey"],
  parseAnswer: (raw) => textAnswer(raw, 60, 3000),
  grade(ctx, answer) {
    if (!ctx.answerKey) return null;
    return looksCopied(answer, [ctx.issue.body]) ? { passed: false, feedback: "This repeats the issue. Say what you would change and why." } : null;
  },
  prompt(ctx, answer) {
    const key = ctx.answerKey;
    const system = [
      `You grade a contributor's plan for fixing an issue in ${ctx.repo}, before they see the real fix.`,
      "", GRADER_UNTRUSTED, "",
      "<answer-key> holds a fix that was found ahead of time and verified by tests. The contributor has not seen it. Use it only to judge.",
      "Never quote it, and never name its files, functions or lines in your feedback: the contributor must not learn the fix from you.",
      "Another approach that would also fix the issue is correct: judge whether it would work, not whether it matches the key.",
      "- cause: true if the plan locates the root cause (where and why it goes wrong).",
      "- change: true if the described change would fix it.",
      "- proof: true if the test idea would fail before the change and pass after it.",
      "- alternative: true if the plan works but differs from the key's approach.",
      "- feedback: two or three plain sentences. Praise what is right. Ask one question about what is missing. If alternative is true, say plainly that their approach would also work.",
      "", JSON_ONLY,
      `{"cause":true,"change":false,"proof":true,"alternative":false,"feedback":"..."}`,
    ].join("\n");
    const cases = key?.cases.map((c) => `- ${c.variant} -> ${c.test ?? "not covered"}`).join("\n") ?? "";
    const user = [
      issueBlock(ctx),
      `<answer-key>\n${fence("diagnosis", key?.diagnosis ?? "", 3000)}\n${fence("cases", cases, 1500)}\n${fence("diff", key?.diff ?? "", 12_000)}\n</answer-key>`,
      fence("contributor-answer", answer, 3000),
    ].join("\n\n");
    return { system, user };
  },
  parseGrade(reply) {
    const o = jsonObject(reply);
    const cause = replyBool(o.cause, "cause");
    const change = replyBool(o.change, "change");
    const proof = replyBool(o.proof, "proof");
    const alternative = replyBool(o.alternative, "alternative");
    return { passed: cause && (change || proof), feedback: replyText(o.feedback, "feedback", 600), detail: { cause, change, proof, alternative } };
  },
};
