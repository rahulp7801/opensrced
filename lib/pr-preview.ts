// The publish gate's record. When a run finishes, the dispatcher freezes
// everything a PR would contain — patch, title, body (with the host-observed
// "Tests run" and the AI-assistance note), commit message, sign-off — into
// .dispatches/<id>/preview.json + final.patch. The run page shows exactly
// that; "Publish" opens the PR from exactly that, with no model re-run.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffTouchedFiles } from "./apply-diff";
import type { ContribProfile } from "./contrib-profile";
import { aiDisclosureMarkdown, aiTrailer, disclosureEnabled, tickAiCheckboxes } from "./disclosure";
import { verificationMarkdown, type CaseCoverage, type Verification } from "./verify";

export type PrPreview = {
  version: 1;
  created_at: string;
  title: string;
  body: string;
  commit_message: string;
  /** `git commit -s` as the publishing user. */
  signoff: boolean;
  files: string[];
  executed: boolean;
  verification: Verification | null;
  profile: Pick<ContribProfile, "dco" | "cla" | "aiPolicy" | "aiTrailer" | "sources"> | null;
  /** Reasons the patch must not be published. Re-checked at publish. */
  blockers: string[];
  /** Shown before publishing; the user decides. */
  warnings: string[];
  /** A comment asking on the issue before sending a PR, for the user to post
   *  themselves. Never posted by opensrcer. */
  draft_issue_comment?: string;
  /** Maintainers ask for discussion first: the comment is the suggested path.
   *  Absent on older previews, whose comment always meant "ask first". */
  ask_first?: boolean;
  /** Reported variants and the test that covers each (null = not covered). */
  cases?: CaseCoverage[];
  /** What the project asks and how this run handled it, for the review
   *  screen's "This project's rules" (lib/project-rules.ts). Absent on older
   *  previews, which the panel then reports as "not recorded". */
  rules?: PreviewRules;
  /** The agent's own diagnosis, for "Ask about this change". */
  diagnosis?: string;
};

/** The other-open-PR check at run end. Publishing runs it again. */
export type CompetingCheck = "none" | "found" | "unchecked" | "followup" | "no_issue";

export type PreviewRules = {
  /** The project has a PR template; the agent was told to fill it in. */
  pr_template: boolean;
  /** The template's headings, and how many of them the PR text contains. */
  template_headings: { total: number; kept: number } | null;
  /** AGENTS.md / CLAUDE.md was handed to the agent. */
  agent_instructions: boolean;
  /** opensrcer's own notes for this project (built-in profiles). */
  notes: number;
  /** Why maintainers ask for discussion first, or null. */
  discuss_first: string | null;
  competing_prs: CompetingCheck;
  /** The AI-assistance note is in the PR body. */
  disclosed: boolean;
};

export type PreviewInput = {
  title: string;
  body: string;
  diff: string;
  profile: ContribProfile | null;
  verification: Verification | null;
  executed: boolean;
  model: string;
  provider: string;
  privateOrg: boolean;
  blockers?: string[];
  warnings?: string[];
  draftIssueComment?: string;
  askFirst?: boolean;
  cases?: CaseCoverage[];
  /** The issue's or the guide's discuss-first reason. */
  discussFirst?: string | null;
  competingPrs?: CompetingCheck;
  diagnosis?: string | null;
};

/** Markdown headings of a PR template, outside HTML comments. */
export function templateHeadings(template: string): string[] {
  return template.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)
    .map((line) => /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line.trim())?.[1].trim() ?? "")
    .filter(Boolean);
}

/** How many of the template's headings are also headings in the PR body
 *  (case-insensitive). Null when the template has no headings. */
function templateKept(template: string | null, body: string): PreviewRules["template_headings"] {
  const headings = template ? templateHeadings(template) : [];
  if (!headings.length) return null;
  const inBody = new Set(templateHeadings(body).map((h) => h.toLowerCase()));
  return { total: headings.length, kept: headings.filter((h) => inBody.has(h.toLowerCase())).length };
}

/** Compose the PR body: the agent's body (template checkboxes about AI use
 *  ticked), then host-observed "Tests run", then the AI-assistance note. */
export function buildPreview(input: PreviewInput): PrPreview {
  const disclose = disclosureEnabled(input.privateOrg);
  const sections = [disclose ? tickAiCheckboxes(input.body) : input.body];
  sections.push(verificationMarkdown(input.executed ? input.verification : null));
  if (disclose) sections.push(aiDisclosureMarkdown({ model: input.model, provider: input.provider, verification: input.verification, executed: input.executed }));
  const trailers = disclose ? `\n\n${aiTrailer(input.profile, input.model)}` : "";
  const warnings = [...(input.warnings ?? [])];
  if (input.profile?.cla) warnings.push(`CLA: ${input.profile.cla}`);
  if (!input.executed || input.verification?.status !== "verified") warnings.push("This patch is not verified: no passing test run was observed on the final patch.");
  else if (input.verification.regression !== "reproduced") warnings.push("No test in the patch fails without the fix, so the bug's reproduction is not demonstrated.");
  return {
    version: 1,
    created_at: new Date().toISOString(),
    title: input.title,
    body: sections.join("\n\n"),
    commit_message: `${input.title}${trailers}`,
    signoff: Boolean(input.profile?.dco),
    files: diffTouchedFiles(input.diff),
    executed: input.executed,
    verification: input.verification,
    profile: input.profile ? { dco: input.profile.dco, cla: input.profile.cla, aiPolicy: input.profile.aiPolicy, aiTrailer: input.profile.aiTrailer, sources: input.profile.sources } : null,
    blockers: [...(input.blockers ?? []), ...(input.verification?.status === "failed" ? [`verification failed: ${input.verification.reason}`] : [])],
    warnings,
    // ask_first is always written with the comment: previews from before it
    // existed carry a comment only when maintainers asked for discussion.
    ...(input.draftIssueComment ? { draft_issue_comment: input.draftIssueComment, ask_first: Boolean(input.askFirst) } : {}),
    ...(input.cases?.length ? { cases: input.cases } : {}),
    rules: {
      pr_template: Boolean(input.profile?.prTemplate),
      template_headings: templateKept(input.profile?.prTemplate ?? null, input.body),
      agent_instructions: Boolean(input.profile?.agentInstructions),
      notes: input.profile?.notes.length ?? 0,
      discuss_first: input.discussFirst ?? null,
      competing_prs: input.competingPrs ?? "no_issue",
      disclosed: disclose,
    },
    ...(input.diagnosis?.trim() ? { diagnosis: input.diagnosis.trim().slice(0, 2000) } : {}),
  };
}

export function previewPaths(dispatchDir: string) {
  return { preview: path.join(dispatchDir, "preview.json"), patch: path.join(dispatchDir, "final.patch") };
}

export async function writePreview(dispatchDir: string, preview: PrPreview, diff: string): Promise<void> {
  const p = previewPaths(dispatchDir);
  await mkdir(dispatchDir, { recursive: true });
  await writeFile(p.patch, diff, { mode: 0o600 });
  await writeFile(p.preview, JSON.stringify(preview, null, 1), { mode: 0o600 });
}

/** The stored preview and patch, or null when the run produced none. */
export async function readPreview(dispatchDir: string): Promise<{ preview: PrPreview; diff: string } | null> {
  const p = previewPaths(dispatchDir);
  try {
    const preview = JSON.parse(await readFile(p.preview, "utf8")) as PrPreview;
    if (preview.version !== 1 || typeof preview.title !== "string" || typeof preview.body !== "string") return null;
    return { preview, diff: await readFile(p.patch, "utf8") };
  } catch {
    return null;
  }
}
