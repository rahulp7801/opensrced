// What happens when an agent run ends: freeze the preview (patch, PR text,
// evidence, guard results) for the publish gate. Nothing is published here;
// app/api/dispatches/[id]/publish opens the PR once the user has reviewed
// the preview and confirmed it.

import { appendFile, readFile } from "node:fs/promises";
import { buildPrContent, extractDiagnosis, extractFirstDiff, refusedPaths } from "./agentic-pr";
import type { ContribProfile } from "./contrib-profile";
import { aiBanReason, competingPrReason, discussFirstReason, draftIssueComment, openPrsForIssue } from "./contrib-guard";
import type { ExecOutcome } from "./exec-run";
import { CLAUDE_AGENT_MODEL } from "./models";
import { buildPreview, writePreview, type CompetingCheck, type PrPreview } from "./pr-preview";
import { parseCases } from "./verify";

export type FinishInput = {
  repoFull: string;
  issueNumber: number;
  dispatchId: string;
  dispatchDir: string;
  logPath: string;
  exec: ExecOutcome | null;
  profile: ContribProfile | null;
  issueLabels: string[];
  privateOrg: boolean;
  token?: string;
  model?: string;
  /** Who served the model, for the disclosure note ("Anthropic" or "OpenAI"). */
  provider?: string;
  /** Produced by the scripted stand-in agent: never publishable. */
  standIn?: boolean;
  /** A follow-up on the user's own PR: that PR is not a competing one. */
  followup?: boolean;
};

/** Build and store the preview. Returns null when there is nothing to
 *  publish (no patch). Never throws on a GitHub lookup failure: a guard that
 *  could not run becomes a warning, and publish re-checks it. */
export async function finishRun(input: FinishInput): Promise<PrPreview | null> {
  const log = (s: string) => appendFile(input.logPath, s).catch(() => {});
  const logText = await readFile(input.logPath, "utf8");
  let diff: string | null;
  if (input.exec) diff = input.exec.patchPath ? await readFile(input.exec.patchPath, "utf8") : null;
  else diff = extractFirstDiff(logText);
  if (!diff?.trim()) {
    await log("\n[preview] no patch to publish\n");
    return null;
  }

  const { title, body } = buildPrContent(input.issueNumber, input.dispatchId, logText, diff);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.exec?.setup?.status === "failed") warnings.push("The host's environment setup failed (see [setup] in the log); test results depend on what the agent could install itself.");
  if (input.standIn) blockers.push("this patch was produced by the scripted stand-in agent (a test harness), not a model; it can never be published");
  const refused = refusedPaths(diff, input.repoFull);
  if (refused.length) blockers.push(`the patch touches paths opensrcer does not publish: ${refused.slice(0, 3).join(", ")}`);
  if (input.profile) {
    const ban = aiBanReason(input.profile);
    if (ban) blockers.push(ban);
  }
  // Recorded for the review screen's "This project's rules".
  let competingPrs: CompetingCheck = input.issueNumber <= 0 ? "no_issue" : input.followup ? "followup" : "none";
  if (competingPrs === "none") {
    try {
      const competing = competingPrReason(await openPrsForIssue(input.repoFull, input.issueNumber, input.token));
      if (competing) { blockers.push(competing); competingPrs = "found"; }
    } catch {
      warnings.push("Could not check for other open PRs on this issue; publishing re-checks it.");
      competingPrs = "unchecked";
    }
  }
  // Issue labels first (specific to this issue), then the guide's general rule.
  const discuss = discussFirstReason("", input.issueLabels) ?? input.profile?.discussFirst ?? null;
  const verification = input.exec?.verification ?? null;
  // The variants the agent listed and which test covers each. Fewer covered
  // than listed is a warning for the reviewer, not a blocker.
  const cases = parseCases(logText);
  const uncovered = cases.filter((c) => !c.test);
  if (uncovered.length) warnings.push(`The agent listed ${cases.length} variant(s) of this bug but covered only ${cases.length - uncovered.length} with a test; not covered: ${uncovered.map((c) => c.variant).join("; ").slice(0, 400)}.`);
  const preview = buildPreview({
    title, body, diff, profile: input.profile, verification, executed: Boolean(input.exec),
    model: input.model ?? CLAUDE_AGENT_MODEL, provider: input.provider ?? "Anthropic", privateOrg: input.privateOrg,
    blockers, warnings: discuss ? [`Maintainers ask for discussion first: ${discuss}. Consider posting the drafted issue comment instead of a PR.`, ...warnings] : warnings,
    // Every new issue run gets the drafted "ask first" comment: asking before
    // sending a PR is good manners anywhere. It is the main suggestion only
    // where maintainers ask for discussion (askFirst); otherwise an option.
    draftIssueComment: input.issueNumber > 0 && !input.followup ? draftIssueComment(extractDiagnosis(logText), verification?.status === "verified") : undefined,
    askFirst: Boolean(discuss),
    cases,
    discussFirst: discuss, competingPrs, diagnosis: extractDiagnosis(logText),
  });
  await writePreview(input.dispatchDir, preview, diff);
  await log(
    `\n[preview] ─────────────────────────────\n` +
    `[preview] ready for review: "${preview.title}" (${preview.files.length} file(s), sign-off=${preview.signoff}, verification=${verification?.status ?? "not run"})\n` +
    preview.blockers.map((b) => `[preview] BLOCKED: ${b}\n`).join("") +
    preview.warnings.map((w) => `[preview] warning: ${w}\n`).join("") +
    `[preview] nothing has been published; review the patch and evidence, then use Publish on the run page\n`,
  );
  return preview;
}
