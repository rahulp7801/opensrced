import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";
import { parseRunTarget } from "@/lib/run-target";

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  const repo_url = typeof body.repo_url === "string" ? body.repo_url : undefined;
  if (!repo_url || typeof repo_url !== "string") {
    return NextResponse.json(
      { status: "error", message: "Missing required field: repo_url" },
      { status: 400 },
    );
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return NextResponse.json({ status: "error", message: "dry_run must be a boolean" }, { status: 400 });
  }
  const dry_run = body.dry_run === true;
  const issue_number: number | undefined =
    typeof body?.issue_number === "number" ? body.issue_number : undefined;

  let canonicalRepoUrl: string;
  try {
    canonicalRepoUrl = `https://github.com/${parseRunTarget(repo_url).repo}`;
    if (issue_number !== undefined && (!Number.isSafeInteger(issue_number) || issue_number < 1)) throw new Error();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid GitHub repository URL or issue number" }, { status: 400 });
  }

  if (cloudExecution() || !canDispatchLocally()) {
    return NextResponse.json(
      {
        status: "error",
        message: "Deterministic dispatch is local-only. Use POST /api/run/agentic in hosted deployments.",
      },
      { status: 501 },
    );
  }

  const extra: string[] = [];
  if (issue_number !== undefined) extra.push("--issue", String(issue_number));

  const token = await resolveGitHubToken();
  const anthropicKey = (await resolveAnthropicKey()) ?? undefined;

  try {
    const d = startDispatch(canonicalRepoUrl, dry_run, "solve", extra, {
      token: token ?? undefined,
      anthropicKey,
      auth0UserId,
    });
    return NextResponse.json(
      {
        status: "running",
        message: issue_number
          ? `Solve pipeline spawned for ${canonicalRepoUrl} issue #${issue_number} (dispatch ${d.id}).`
          : `Solve pipeline spawned (dispatch ${d.id}). Will pull open issues from ${canonicalRepoUrl}.`,
        dispatch_id: d.id,
        mode: "solve",
        dry_run,
        issue_number,
        queued_at: d.started_at,
        watch_url: `/api/dispatches/${d.id}`,
      },
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      { status: "error", message: "Could not start the local solve worker. Check the server configuration." },
      { status: 503 },
    );
  }
}
