// GET  /api/prs/lifecycle                       lifecycle state of the caller's opensrcer PRs
// POST /api/prs/lifecycle { pr_url, followups } per-PR opt-in for follow-up pushes and rebases
//
// State is written by the poller (scripts/pr-lifecycle.cjs). Nothing here
// posts to GitHub: pending replies are drafted and posted from the PR page.
// Local mode only; hosted runs have no poller yet.

import { NextRequest, NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { readJsonBody } from "@/lib/request-body";
import { listAll } from "@/lib/dispatch-store";
import { parseGitHubPullUrl } from "@/lib/github-pull-url";
import { loadState, setFollowups } from "@/lib/pr-lifecycle";
import { cloudExecution } from "@/lib/cloud-run-state";

function ownedPrs(owner: string) {
  return listAll(owner).flatMap((r) => {
    const pr = r.pr_url ? parseGitHubPullUrl(r.pr_url) : null;
    return pr ? [{ repo: pr.repoFull, number: pr.prNumber, url: pr.url }] : [];
  });
}

export async function GET() {
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (cloudExecution()) return NextResponse.json({ prs: [] });
  const prs = await Promise.all(ownedPrs(owner).map(async (pr) => ({ ...pr, state: await loadState(pr) })));
  return NextResponse.json({ prs });
}

export async function POST(req: NextRequest) {
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (cloudExecution()) return NextResponse.json({ error: "Follow-ups run in local mode only." }, { status: 501 });
  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  if (typeof body.pr_url !== "string" || typeof body.followups !== "boolean") {
    return NextResponse.json({ error: "pr_url (string) and followups (boolean) are required" }, { status: 400 });
  }
  const target = parseGitHubPullUrl(body.pr_url);
  // Only PRs this user opened through opensrcer can be opted in.
  const pr = target && ownedPrs(owner).find((p) => p.url.toLowerCase() === target.url.toLowerCase());
  if (!pr) return NextResponse.json({ error: "not found" }, { status: 404 });
  const state = await setFollowups({ repo: pr.repo, number: pr.number }, body.followups);
  return NextResponse.json({ pr: pr.url, followups: state.followups });
}
