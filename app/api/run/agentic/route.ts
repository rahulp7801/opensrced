import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { RunStartError, startIssueRun } from "@/lib/run-start";

// startCloudRun's bounded steps (capacity reads, record writes, Sandbox.create,
// protocol check, launch) can exceed 120s; a kill mid-start strands the lease.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  const repo_url = typeof body.repo_url === "string" ? body.repo_url : undefined;
  let target: ReturnType<typeof parseRunTarget>;
  try {
    target = parseRunTarget(repo_url);
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid GitHub repository URL" }, { status: 400 });
  }
  const canonicalRepoUrl = `https://github.com/${target.repo}`;
  // An issue URL carries its own number; a different explicit number is a mistake, not a choice.
  if (body.issue_number !== undefined && target.issue !== undefined && body.issue_number !== target.issue) {
    return NextResponse.json({ status: "error", message: `The URL points at issue #${target.issue} but issue_number is ${String(body.issue_number)}.` }, { status: 400 });
  }
  const issue_number: number | undefined =
    typeof body.issue_number === "number" ? body.issue_number : body.issue_number === undefined ? target.issue : undefined;

  if (!Number.isSafeInteger(issue_number) || !issue_number || issue_number < 1) {
    return NextResponse.json(
      { status: "error", message: "issue_number must be a positive whole number, or use an issue URL." },
      { status: 400 },
    );
  }
  if ((body.dry_run !== undefined && typeof body.dry_run !== "boolean") ||
      (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 5000))) {
    return NextResponse.json({ status: "error", message: "Invalid dry_run or notes" }, { status: 400 });
  }

  try {
    // The same start path as a lesson's hidden run (lib/run-start.ts).
    const d = await startIssueRun({
      repoUrl: canonicalRepoUrl, issueNumber: issue_number, auth0UserId,
      dryRun: body.dry_run === true, notes: body.notes as string | undefined, signal: req.signal,
    });
    return NextResponse.json(
      {
        status: "running",
        message: `Agentic solve spawned for ${canonicalRepoUrl} issue #${issue_number} (dispatch ${d.id}).`,
        dispatch_id: d.id,
        mode: "agentic",
        issue_number,
        queued_at: d.started_at,
        watch_url: `/api/dispatches/${d.id}`,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof RunStartError) return NextResponse.json({ status: "error", message: err.message }, { status: err.status });
    throw err;
  }
}
