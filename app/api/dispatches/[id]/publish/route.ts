// POST /api/dispatches/<id>/publish  { confirmed: true, includeApproach?: boolean }
//
// The publish gate: opens the draft PR from the run's frozen preview (the
// exact patch and text shown on the run page), after the owner confirms
// they read the change and can explain it. Nothing is regenerated.
// includeApproach adds "How I approached this" from the run's lesson, built
// here from the lesson record, never from text the page sends.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { resolveCommitAuthor, resolveGitHubToken } from "@/lib/github-token";
import { resolveGeminiKey } from "@/lib/api-keys";
import { parseAuthorWords, PublishError, publishDispatch } from "@/lib/publish";
import { publishCloudRun } from "@/lib/cloud-publish";
import { flagEnabled } from "@/lib/flags";
import { getDb } from "@/lib/db/client";
import { parseGitHubPullUrl } from "@/lib/github-pull-url";
import { approachForRun } from "@/lib/lesson/approach";
import { lessonStore } from "@/lib/lesson/db-store";
import { recordPublished } from "@/lib/record/sync";

export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewerId = await sessionUserId();
  if (!viewerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  try {
    const [token, author, geminiKey] = await Promise.all([
      resolveGitHubToken(),
      resolveCommitAuthor(req.signal).catch(() => null),
      resolveGeminiKey(),
    ]);
    // Optional: the author's own explanation, for the PR body.
    const authorWords = parseAuthorWords(body);
    if (body.includeApproach != null && typeof body.includeApproach !== "boolean") throw new PublishError(400, "includeApproach must be true or false.");
    const approach = body.includeApproach === true ? await approachForRun(lessonStore(), viewerId, id) : null;
    // Hosted runs: same checks, then a short-lived push VM opens the PR.
    const result = cloudExecution()
      ? await publishCloudRun({ id, viewerId, confirmed: body.confirmed, authorWords, approach, token, author, signal: req.signal })
      : await publishDispatch({ id, viewerId, confirmed: body.confirmed, authorWords, approach, token, author, geminiKey: geminiKey ?? undefined });
    if (flagEnabled("record") && author) await recordPr(viewerId, author.login, id, result.url);
    return NextResponse.json({ ok: true, pr_url: result.url, tests: result.tests });
  } catch (error) {
    if (error instanceof PublishError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not publish. Try again." }, { status: 500 });
  }
}

/** The contribution record (PLAN §9.1). The PR is already open, so a failure
 *  here is logged, not reported as a failed publish. */
async function recordPr(viewerId: string, login: string, runId: string, url: string) {
  const pr = parseGitHubPullUrl(url);
  if (!pr) return;
  try {
    const lesson = await lessonStore().findByRun(runId);
    await recordPublished(await getDb(), { userId: viewerId, login, repoFull: pr.repoFull, prNumber: pr.prNumber, path: lesson?.path === "B" ? "self" : "ai" });
  } catch (error) {
    console.error("[record] could not record the published PR", url, error);
  }
}
