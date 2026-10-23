// GET  /api/prs/lifecycle?pr_url=...            poll one of the caller's opensrcer PRs (read-only on
//                                                GitHub) and return its follow-up view: events, CI,
//                                                opt-in, which follow-up actions are possible
// POST /api/prs/lifecycle { pr_url, followups }  per-PR opt-in for follow-up runs ("Help me with follow-ups")
//
// Nothing here posts to GitHub: pending replies are drafted and posted from
// the PR page by the user. Local and hosted (lib/pr-followups.ts).

import { NextRequest, NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { resolveGitHubToken } from "@/lib/github-token";
import { FollowupError, pollFollowups, setFollowupOptIn } from "@/lib/pr-followups";

function failure(error: unknown) {
  if (error instanceof FollowupError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not read this pull request's follow-ups. Try again." }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const prUrl = req.nextUrl.searchParams.get("pr_url");
  if (!prUrl) return NextResponse.json({ error: "pr_url is required" }, { status: 400 });
  try {
    return NextResponse.json(await pollFollowups(owner, prUrl, (await resolveGitHubToken()) ?? undefined));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  if (typeof body.pr_url !== "string" || typeof body.followups !== "boolean") {
    return NextResponse.json({ error: "pr_url (string) and followups (boolean) are required" }, { status: 400 });
  }
  try {
    // Only PRs this user opened through opensrcer can be opted in.
    return NextResponse.json({ pr: body.pr_url, followups: await setFollowupOptIn(owner, body.pr_url, body.followups) });
  } catch (error) {
    return failure(error);
  }
}
