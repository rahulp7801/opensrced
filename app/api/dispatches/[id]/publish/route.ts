// POST /api/dispatches/<id>/publish  { confirmed: true }
//
// The publish gate: opens the draft PR from the run's frozen preview (the
// exact patch and text shown on the run page), after the owner confirms
// they read the change and can explain it. Nothing is regenerated.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { resolveCommitAuthor, resolveGitHubToken } from "@/lib/github-token";
import { resolveGeminiKey } from "@/lib/api-keys";
import { PublishError, publishDispatch } from "@/lib/publish";
import { publishCloudRun } from "@/lib/cloud-publish";

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
    // Hosted runs: same checks, then a short-lived push VM opens the PR.
    const result = cloudExecution()
      ? await publishCloudRun({ id, viewerId, confirmed: body.confirmed, token, author, signal: req.signal })
      : await publishDispatch({ id, viewerId, confirmed: body.confirmed, token, author, geminiKey: geminiKey ?? undefined });
    return NextResponse.json({ ok: true, pr_url: result.url, tests: result.tests });
  } catch (error) {
    if (error instanceof PublishError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not publish. Try again." }, { status: 500 });
  }
}
