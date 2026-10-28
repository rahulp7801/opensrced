// s4 The task: expected vs actual behaviour, who is affected, how to
// reproduce. Graded by the fast model against the issue and, when the hidden
// fix has one, its diagnosis (used to judge, never quoted back).

import { jsonObject, looksCopied, replyBool, replyText } from "../../understanding";
import { fence, GRADER_UNTRUSTED, issueBlock, JSON_ONLY, textAnswer, type StepDef } from "./shared";

export const S4_COPIED = "This repeats the issue. Say what goes wrong in your own words.";

export const s4: StepDef<string> = {
  id: "s4",
  title: "The task",
  question: "What should happen, what happens instead, who runs into it, and how would you reproduce it?",
  hintQuestion: "What exact input or action does the issue start from, and what result did the reporter expect?",
  nudge: "Reread the issue's first message and any code or steps in it; then try to say the bug as \"when I do X, I expect Y but get Z\".",
  needs: ["issue", "answerKey"],
  parseAnswer: (raw) => textAnswer(raw, 80, 3000),
  grade(ctx, answer) {
    return looksCopied(answer, [ctx.issue.body]) ? { passed: false, feedback: S4_COPIED } : null;
  },
  prompt(ctx, answer) {
    const system = [
      `You check whether a contributor understands an issue in ${ctx.repo} before they work on it.`,
      "", GRADER_UNTRUSTED, "",
      "The <diagnosis> is the real cause, found ahead of time. Use it only to judge; never quote or hint at it in your feedback.",
      "Judge meaning, not wording. Judge only what the answer says.",
      "- behaviour: true if it states the expected and the actual behaviour correctly (the root behaviour, not a symptom of a symptom).",
      "- repro: true if the reproduction steps are plausible for this issue (specific input or action, then what to look at).",
      "- feedback: one or two plain sentences: what is right, and one question that would sharpen it. Do not mention files, functions or the fix.",
      "", JSON_ONLY,
      `{"behaviour":true,"repro":true,"feedback":"..."}`,
    ].join("\n");
    const user = [
      issueBlock(ctx),
      fence("diagnosis", ctx.answerKey?.diagnosis ?? "", 3000),
      fence("contributor-answer", answer, 3000),
    ].join("\n\n");
    return { system, user };
  },
  parseGrade(reply) {
    const o = jsonObject(reply);
    const behaviour = replyBool(o.behaviour, "behaviour");
    const repro = replyBool(o.repro, "repro");
    return { passed: behaviour && repro, feedback: replyText(o.feedback, "feedback", 400), detail: { behaviour, repro } };
  },
};
