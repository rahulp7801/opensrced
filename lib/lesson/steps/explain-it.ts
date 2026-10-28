// Explain-it (path A, after the reveal; stricter than the review page's
// check): (1) one sentence per changed file, (2) why the test proves the fix,
// (3) the two practice review questions, answered through /api/understand in
// lesson mode (which records them for the run). All three must pass, and the
// copy check runs on each written part. Parts 1 and 3 are checked here;
// part 2 by one fast-model call.

import { jsonObject, looksCopied, replyBool, replyText } from "../../understanding";
import { hiddenDiffFacts } from "../leak";
import { fence, GRADER_UNTRUSTED, JSON_ONLY, StepInputError, textAnswer, wordsIn, type StepDef } from "./shared";

export type ExplainItAnswer = { files: Record<string, string>; test: string };

export const FILE_SENTENCE_MIN_WORDS = 6;
export const PRACTICE_NEEDED = 2;

export const explainIt: StepDef<ExplainItAnswer> = {
  id: "explain-it",
  title: "Explain it",
  question: "Now that you have seen the fix: one sentence per changed file on what it does there, and why the test proves the fix. Then answer the two practice review questions.",
  hintQuestion: "For each file: what would break if that file's change were left out?",
  nudge: "Read the test first: what input does it use, and what does it expect? Then find the line in the fix that makes that expectation true.",
  needs: ["answerKey", "practice"],
  parseAnswer(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StepInputError("Send { files: { path: sentence }, test }.");
    const body = raw as Record<string, unknown>;
    if (!body.files || typeof body.files !== "object" || Array.isArray(body.files)) throw new StepInputError("files must map each changed file to a sentence.");
    const entries = Object.entries(body.files as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 30) throw new StepInputError("Write one sentence for each changed file.");
    const files: Record<string, string> = {};
    for (const [path, sentence] of entries) files[path.slice(0, 300)] = textAnswer(sentence, 1, 600, `sentence for ${path}`);
    return { files, test: textAnswer(body.test, 40, 2000, "test explanation") };
  },
  grade(ctx, answer) {
    if (!ctx.answerKey) return { passed: false, feedback: "There is no revealed fix to explain." };
    const changed = hiddenDiffFacts(ctx.answerKey.diff).files;
    const missing = changed.filter((f) => wordsIn(answer.files[f] ?? "") < FILE_SENTENCE_MIN_WORDS);
    if (missing.length) return { passed: false, feedback: `Write a full sentence for ${missing.join(", ")}.`, detail: { missing } };
    const aiText = [ctx.answerKey.diagnosis, ctx.answerKey.title];
    const copied = [...Object.values(answer.files), answer.test].some((part) => wordsIn(part) >= 6 && looksCopied(part, aiText));
    if (copied) return { passed: false, feedback: "Part of this repeats the AI's own description. Say it your way." };
    if ((ctx.practiced ?? 0) < PRACTICE_NEEDED) return { passed: false, feedback: `Answer the ${PRACTICE_NEEDED} practice review questions too.` };
    return null;
  },
  prompt(ctx, answer) {
    const key = ctx.answerKey;
    const system = [
      `You check whether a contributor can explain why a test proves a fix in ${ctx.repo}. The fix is revealed; this is the stricter check before they publish.`,
      "", GRADER_UNTRUSTED, "",
      "- proves: true if the explanation correctly says what the test does and why it fails without the fix and passes with it, consistent with the diff.",
      "- feedback: one or two plain sentences: what is right, and what a reviewer would still ask.",
      "", JSON_ONLY,
      `{"proves":true,"feedback":"..."}`,
    ].join("\n");
    const cases = key?.cases.map((c) => `- ${c.variant} -> ${c.test ?? "not covered"}`).join("\n") ?? "";
    const user = [fence("diff", key?.diff ?? "", 12_000), fence("cases", cases, 1500), fence("contributor-answer", answer.test, 2000)].join("\n\n");
    return { system, user };
  },
  parseGrade(reply) {
    const o = jsonObject(reply);
    const proves = replyBool(o.proves, "proves");
    return { passed: proves, feedback: replyText(o.feedback, "feedback", 400), detail: { proves } };
  },
};
