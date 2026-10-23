// POST /api/prs/followup { pr_url, kind: "ci" | "review" }
//
// "Fix CI failure" / "Address review" on the PR page: starts an ordinary
// agent run pinned to the head of the caller's own opensrcer PR, with the
// recorded CI failure or review comments as its task. The run ends at the
// publish gate like every run; publishing it pushes one commit to the PR's
// branch only after the owner confirms (lib/publish.ts). Needs the per-PR
// opt-in. Local and hosted.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { resolveCommitAuthor, resolveGitHubToken } from "@/lib/github-token";
import { resolveGeminiKey, resolveMaxSpendUsd, resolveRunPayment } from "@/lib/api-keys";
import { NoRunCredentialError } from "@/lib/run-payment";
import { RunTargetError, startAgenticDispatch } from "@/lib/agentic-dispatcher";
import { CapacityError } from "@/lib/concurrency";
import { cloudExecution } from "@/lib/cloud-run-state";
import { startCloudRun } from "@/lib/cloud-runs";
import { FollowupError, startFollowupRun } from "@/lib/pr-followups";

// Same bound as a run start (Sandbox.create, protocol check, launch).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  if (typeof body.pr_url !== "string" || (body.kind !== "ci" && body.kind !== "review")) {
    return NextResponse.json({ error: "pr_url (string) and kind (\"ci\" or \"review\") are required" }, { status: 400 });
  }
  const token = await resolveGitHubToken();
  const author = token ? (await resolveCommitAuthor(req.signal).catch(() => null)) ?? undefined : undefined;
  if (!token || !author) return NextResponse.json({ error: "Sign in with GitHub again: follow-ups are pushed from your account." }, { status: 401 });
  try {
    const payment = await resolveRunPayment();
    const run = await startFollowupRun(auth0UserId, body.pr_url, body.kind, token, {
      provider: payment.provider, anthropicKey: payment.anthropicKey, keyFallback: payment.keyFallback,
      geminiKey: (await resolveGeminiKey()) ?? undefined, maxSpendUsd: await resolveMaxSpendUsd(),
      auth0UserId, author,
    }, cloudExecution() ? startCloudRun : startAgenticDispatch);
    return NextResponse.json({ dispatch_id: run.id, run_url: `/dispatches?dispatch=${encodeURIComponent(run.id)}` }, { status: 202 });
  } catch (error) {
    if (error instanceof FollowupError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof NoRunCredentialError || error instanceof RunTargetError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof CapacityError) return NextResponse.json({ error: error.message }, { status: 429 });
    return NextResponse.json({ error: "Could not start the follow-up run. Try again." }, { status: 503 });
  }
}
