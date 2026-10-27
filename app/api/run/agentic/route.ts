import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { findOpenRunPr, RunTargetError, startAgenticDispatch } from "@/lib/agentic-dispatcher";
import { resolveCommitAuthor, resolveGitHubToken, type CommitAuthor } from "@/lib/github-token";
import { resolveGeminiKey, resolveMaxSpendUsd, resolveRunPayment } from "@/lib/api-keys";
import { NoRunCredentialError, type RunPayment } from "@/lib/run-payment";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { CapacityError } from "@/lib/concurrency";
import { cloudExecution } from "@/lib/cloud-run-state";
import { startCloudRun } from "@/lib/cloud-runs";
import { optOutReason } from "@/lib/interest";

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

  // Resolve the logged-in user's GitHub token from their Auth0 session so
  // the agentic child process — and the auto-PR hook after it — authenticate
  // as THEM. There is no env or gh-keychain fallback; see lib/github-token.ts.
  const token = await resolveGitHubToken();
  if (!token && body.dry_run !== true) {
    return NextResponse.json(
      { status: "error", message: "Sign in with GitHub before starting a live solve. GitHub access is required to open the pull request." },
      { status: 401 },
    );
  }
  // Subscription first; the API key only when ranked first or opted in as fallback.
  let payment: RunPayment;
  try { payment = await resolveRunPayment(); }
  catch (error) {
    if (!(error instanceof NoRunCredentialError)) throw error;
    return NextResponse.json({ status: "error", message: error.message }, { status: 400 });
  }
  // Live runs commit as the requester, never as the deployer.
  let author: CommitAuthor | undefined;
  if (body.dry_run !== true) {
    author = (await resolveCommitAuthor(req.signal).catch(() => null)) ?? undefined;
    if (!author) return NextResponse.json({ status: "error", message: "Sign in with GitHub again before starting a live solve." }, { status: 401 });
  }

  try {
    const optedOut = await optOutReason(target.repo);
    if (optedOut) throw new RunTargetError(`Refused: ${optedOut}. No code is written, not even a preview. You can still explore the code and ask about it in Explore.`);
    if (author && token) {
      const existing = await findOpenRunPr(parseRunTarget(canonicalRepoUrl).repo, issue_number, author.login, token, req.signal);
      if (existing) throw new RunTargetError(`You already have an open pull request for this issue: ${existing}. Close it before starting another live run.`);
    }
    const geminiKey = (await resolveGeminiKey()) ?? undefined;
    const maxSpendUsd = await resolveMaxSpendUsd();
    const start = cloudExecution() ? startCloudRun : startAgenticDispatch;
    const d = await start(canonicalRepoUrl, issue_number, {
      token: token ?? undefined,
      provider: payment.provider,
      anthropicKey: payment.anthropicKey,
      keyFallback: payment.keyFallback,
      geminiKey,
      maxSpendUsd,
      auth0UserId,
      author,
      dryRun: body.dry_run === true,
      notes: body.notes,
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
    if (err instanceof RunTargetError) return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    const capacity = err instanceof CapacityError;
    return NextResponse.json(
      { status: "error", message: capacity ? err.message : "Could not start the worker. Check the server configuration and try again." },
      { status: capacity ? 429 : 503 },
    );
  }
}
