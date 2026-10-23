// AI-assistance disclosure for everything opensrcer drafts for a human to
// post under their own name: PR bodies, commit trailers, follow-up comments.
// On by default. Maintainers should be able to tell, at a glance, which tool
// was used, that a person asked for it and reviewed it, which model ran, and
// exactly what was verified. Factual, short, no marketing.

import type { ContribProfile } from "./contrib-profile";
import type { Verification } from "./verify";

export type DisclosureInput = {
  model: string;
  provider: string;
  verification: Verification | null;
  /** Exec-box runs could run code; text-diff runs could not. */
  executed: boolean;
};

/** Private-org (crucible) runs may turn disclosure off with
 *  OPENSRCER_AI_DISCLOSURE=0; public contributions always disclose. */
export function disclosureEnabled(privateOrg: boolean): boolean {
  return !privateOrg || process.env.OPENSRCER_AI_DISCLOSURE !== "0";
}

function verifiedLine(input: DisclosureInput): string {
  const v = input.verification;
  if (!input.executed) return "Not verified: the tool could not run code for this change; no tests were run.";
  if (!v || v.status === "unverified") return `Not verified${v ? ` (${v.reason})` : ""}; no tests were run against the final patch.`;
  if (v.status === "failed") return `Verification FAILED (${v.reason}); see "Tests run".`;
  return v.regression === "reproduced"
    ? `The tool re-ran the commands under "Tests run" on the final patch: they pass, and the new test fails without the fix.`
    : `The tool re-ran the commands under "Tests run" on the final patch and they pass.`;
}

/** The PR body section. */
export function aiDisclosureMarkdown(input: DisclosureInput): string {
  return [
    "### AI assistance",
    "",
    `This change was drafted with [opensrcer](https://github.com/rahulp7801/opensrced), an AI coding tool, at the request of the PR author, who reviewed the diff and the test evidence before opening this PR and is responsible for it.`,
    "",
    `- Model: ${input.model} (${input.provider}), driven through ${input.provider === "OpenAI" ? "the Codex CLI" : "Claude Code"} with repository-scoped tools.`,
    `- Verification: ${verifiedLine(input)}`,
  ].join("\n");
}

/** Tick a template's "AI assistance was used" style checkbox, if present. */
export function tickAiCheckboxes(body: string): string {
  return body.replace(/^(\s*[-*]\s*)\[ \](\s*[^\n]*\b(?:AI|LLM|generative)\b[^\n]*(?:used|assist|generated)[^\n]*)$/gim, "$1[x]$2");
}

/** Commit message trailers: DCO sign-off is added by `git commit -s`; the
 *  AI trailer uses the key the repository prescribes, else Assisted-by. */
export function aiTrailer(profile: Pick<ContribProfile, "aiTrailer"> | null, model: string): string {
  return `${profile?.aiTrailer ?? "Assisted-by"}: ${model} via opensrcer`;
}

/** Appended to drafted PR comments (follow-ups, explanations) so posted
 *  text carries the same note as the PR body. */
export function commentDisclosure(model: string): string {
  return `\n\n<sub>Drafted with AI assistance (opensrcer, ${model}); reviewed and posted by me.</sub>`;
}

/** Phrases that instruct a model to hide AI involvement. A test greps the
 *  prompts for them so they cannot creep back in. */
export const HIDING_PHRASES = [
  /no AI mentions?/i,
  /do not mention (?:AI|automation|that (?:this|it) was)/i,
  /don'?t mention (?:AI|automation)/i,
  /without mentioning (?:AI|automation)/i,
  /(?:hide|conceal) (?:the )?(?:use of )?AI/i,
  /regular contribution/i,
];
