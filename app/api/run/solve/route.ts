import { NextRequest, NextResponse } from "next/server";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/require-session";

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const body = await req.json().catch(() => ({}));
  const repo_url: string | undefined = body?.repo_url;
  if (!repo_url || typeof repo_url !== "string") {
    return NextResponse.json(
      { status: "error", message: "Missing required field: repo_url" },
      { status: 400 },
    );
  }
  const dry_run: boolean = Boolean(body?.dry_run);
  const issue_number: number | undefined =
    typeof body?.issue_number === "number" ? body.issue_number : undefined;

  if (!canDispatchLocally()) {
    return NextResponse.json(
      { status: "error", message: "Local dispatcher not configured (CONTRIBAI_BIN unset)." },
      { status: 400 },
    );
  }

  const extra: string[] = [];
  if (issue_number !== undefined) extra.push("--issue", String(issue_number));

  const token = await resolveGitHubToken();
  const anthropicKey = (await resolveAnthropicKey()) ?? undefined;

  try {
    const d = startDispatch(repo_url, dry_run, "solve", extra, { token: token ?? undefined, anthropicKey });
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
