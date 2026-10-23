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
import { verificationMarkdown, type Verification } from "./verify";

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
  /** For issues where maintainers ask to discuss first: a comment the user
   *  can post themselves. Never posted by opensrcer. */
  draft_issue_comment?: string;
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
};

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
    ...(input.draftIssueComment ? { draft_issue_comment: input.draftIssueComment } : {}),
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
