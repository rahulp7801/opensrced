import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { sessionUserId } from "@/lib/require-session";
import { cloudExecution } from "@/lib/cloud-run-state";

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
  const dry_run: boolean = Boolean(body?.dry_run);
  const issue_number: number | undefined =
    typeof body?.issue_number === "number" ? body.issue_number : undefined;

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
    const d = startDispatch(repo_url, dry_run, "solve", extra, {
      token: token ?? undefined,
      anthropicKey,
      auth0UserId,
    });
    return NextResponse.json(
      {
        status: "running",
        message: issue_number
          ? `Solve pipeline spawned for ${repo_url} issue #${issue_number} (dispatch ${d.id}).`
          : `Solve pipeline spawned (dispatch ${d.id}). Will pull open issues from ${repo_url}.`,
        dispatch_id: d.id,
        mode: "solve",
        dry_run,
        issue_number,
        queued_at: d.started_at,
        watch_url: `/api/dispatches/${d.id}`,
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
