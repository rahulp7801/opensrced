// s1 What the project does: in their own words, at least 60 words. Graded by
// the fast model against the README and the graph's main modules: who uses
// it, what it is for, and at least two main parts. Copying the README is
// turned back before any call.

import { buildModuleMap } from "../../graph";
import { jsonObject, looksCopied, replyBool, replyText, ReplyFormatError } from "../../understanding";
import { fence, GRADER_UNTRUSTED, issueBlock, JSON_ONLY, StepInputError, textAnswer, wordsIn, type StepContext, type StepDef } from "./shared";

export const S1_MIN_WORDS = 60;
export const S1_COPIED = "This reads like the README. Say it the way you'd tell a friend.";

/** The graph's largest modules, by node count: "the main parts" s1 looks for. */
export function topModules(ctx: StepContext, limit = 8): string[] {
  if (!ctx.graph) return [];
  const names = buildModuleMap(ctx.graph);
  const sizes = new Map<number, number>();
  // Only the project's own code counts: external packages are not its parts.
  for (const n of ctx.graph.nodes) if (n.source_file) sizes.set(n.community, (sizes.get(n.community) ?? 0) + 1);
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
  // Several modules in one folder would all read "src/pkg" (a real rubric listed it five
  // times): those are named by the file most of their code is in, so each part is checkable.
  const folder = top.map((c) => names.get(c) ?? `module ${c}`);
  const shared = new Set(folder.filter((n, i) => folder.indexOf(n) !== i));
  const mainFile = (c: number) => {
    const files = new Map<string, number>();
    for (const n of ctx.graph!.nodes) if (n.community === c && n.source_file) files.set(n.source_file, (files.get(n.source_file) ?? 0) + 1);
    return [...files.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return [...new Set(top.map((c, i) => (shared.has(folder[i]!) ? mainFile(c) ?? folder[i]! : folder[i]!)))];
}

export const s1: StepDef<string> = {
  id: "s1",
  title: "What the project does",
  question: "In your own words: what does this project do, who uses it, and what are its main parts? (60 words or more)",
  hintQuestion: "If a friend asked what this project is for, what is the first thing you would say? Who would install it?",
  nudge: "Read the first screen of the README, then look at the top-level folders: each big folder is usually one main part.",
  needs: ["readme", "graph"],
  parseAnswer(raw) {
    const text = textAnswer(raw, 1, 3000);
    if (wordsIn(text) < S1_MIN_WORDS) throw new StepInputError(`Write at least ${S1_MIN_WORDS} words.`);
    return text;
  },
  grade(ctx, answer) {
    // Deterministic, before any model call: no spend on a copy.
    return looksCopied(answer, [ctx.readme]) ? { passed: false, feedback: S1_COPIED } : null;
  },
  prompt(ctx, answer) {
    const system = [
      `You check whether a newcomer understands what an open-source project (${ctx.repo}) is, from their own summary.`,
      "", GRADER_UNTRUSTED, "",
      "Judge meaning, not wording or grammar (a non-native writer with the right idea passes). Judge only what the summary says.",
      "- users: true if it says who uses the project (a kind of developer, team or user).",
      "- purpose: true if it says what the project is for, consistent with the README.",
      "- parts: how many distinct main parts of the project it names correctly (folders, modules or components that exist).",
      "- feedback: one or two plain, friendly sentences: what is good, and the one thing to add or fix.",
      "", JSON_ONLY,
      `{"users":true,"purpose":true,"parts":2,"feedback":"..."}`,
    ].join("\n");
    const modules = topModules(ctx);
    const user = [
      fence("readme", ctx.readme, 6000),
      fence("modules", modules.length ? modules.map((m) => `- ${m}`).join("\n") : "", 1500),
      issueBlock(ctx),
      fence("contributor-answer", answer, 3000),
    ].join("\n\n");
    return { system, user };
  },
  parseGrade(reply) {
    const o = jsonObject(reply);
    const parts = o.parts;
    if (typeof parts !== "number" || !Number.isInteger(parts) || parts < 0 || parts > 50) throw new ReplyFormatError("parts must be a whole number");
    const users = replyBool(o.users, "users");
    const purpose = replyBool(o.purpose, "purpose");
    return { passed: users && purpose && parts >= 2, feedback: replyText(o.feedback, "feedback", 400), detail: { users, purpose, parts } };
  },
};
