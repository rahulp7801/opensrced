// GET /api/dispatches/<id>/preview — the frozen publish-gate preview: the
// exact patch, PR text, evidence, warnings and blockers. Owner only.
// The PR text is shown as publishing will send it: with the project's AI
// policy read now (a ban becomes a blocker, a disclosure rule is quoted), and,
// for a lesson's run, a second version with "How I approached this".

import { NextResponse } from "next/server";
import { join } from "node:path";
import { sessionUserId } from "@/lib/require-session";
import { getDispatch } from "@/lib/dispatcher";
import { readPreview } from "@/lib/pr-preview";
import { CONFIRMATION, withEvidence, type StoredPreview } from "@/lib/publish";
import { AiPolicyFetchError, aiPolicyBanReason, repoAiPolicy, type RepoAiPolicy } from "@/lib/ai-policy";
import { gh } from "@/lib/gh";
import { resolveGitHubToken } from "@/lib/github-token";
import { approachForRun } from "@/lib/lesson/approach";
import { lessonStore } from "@/lib/lesson/db-store";
import { profileUrlFor } from "@/lib/record/profile";
import { parseRunTarget } from "@/lib/run-target";
import { cloudExecution } from "@/lib/cloud-run-state";
import { getCloudRun } from "@/lib/cloud-runs";
import { getCloudPreview } from "@/lib/cloud-publish";
import { HIDDEN_RUN_MESSAGE, hiddenRunLocked } from "@/lib/hidden-runs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    // Both lookups answer "not yours" like "missing".
    const d = cloudExecution() ? await getCloudRun(viewerId, id) : getDispatch(id, viewerId);
    if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (await hiddenRunLocked(viewerId, d)) return NextResponse.json({ error: HIDDEN_RUN_MESSAGE }, { status: 403 });
    const stored = cloudExecution() ? await getCloudPreview(viewerId, id) : await readPreview(join(process.cwd(), ".dispatches", id));
    if (!stored) return NextResponse.json({ error: "no preview for this run" }, { status: 404 });
    const [evidence, approach] = await Promise.all([policyEvidence(stored, d.repo_url), approachForRun(lessonStore(), viewerId, id)]);
    const profileUrl = approach ? await profileUrlFor(viewerId) : null;
    return NextResponse.json({ ...stored.preview, ...evidence.fields, diff: stored.diff, confirmation: CONFIRMATION, publishable: !d.dry_run && (d.pr_status === "awaiting_review" || d.pr_status === "failed"),
      ...(approach ? { approach, body_with_approach: withEvidence(stored, approach, evidence.policy, profileUrl).preview.body } : {}),
      // A follow-up run publishes as one commit on this PR, not a new PR.
      ...(d.followup_pr ? { followup_pr: d.followup_pr } : {}) });
  } catch (error) {
    console.error("[runs] could not read a preview", error);
    return NextResponse.json({ error: "This preview is temporarily unavailable. Please retry." }, { status: 503 });
  }
}

/** The project's AI policy now (cached), as publishing will apply it. A read
 *  that fails becomes a warning here; publishing reads it again and refuses then. */
async function policyEvidence(stored: StoredPreview, repoUrl: string): Promise<{ policy: RepoAiPolicy | null; fields: Pick<StoredPreview["preview"], "body" | "blockers" | "warnings"> & { ai_policy: RepoAiPolicy | null } }> {
  const token = await resolveGitHubToken();
  let policy: RepoAiPolicy | null = null;
  const warnings = [...stored.preview.warnings];
  try {
    if (token) policy = await repoAiPolicy(gh(token), parseRunTarget(repoUrl).repo);
  } catch (error) {
    if (!(error instanceof AiPolicyFetchError)) throw error;
    warnings.push("Could not read the project's AI policy just now; publishing checks it again.");
  }
  const ban = policy && aiPolicyBanReason(policy);
  return { policy, fields: {
    body: withEvidence(stored, null, policy).preview.body,
    blockers: ban ? [...stored.preview.blockers, ban] : stored.preview.blockers,
    warnings, ai_policy: policy,
  } };
}
