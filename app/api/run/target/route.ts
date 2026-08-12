import { NextRequest, NextResponse } from "next/server";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { sessionUserId } from "@/lib/require-session";

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const repo_url: string | undefined = body?.repo_url;
  if (!repo_url || typeof repo_url !== "string") {
    return NextResponse.json(
      { status: "error", message: "Missing required field: repo_url" },
      { status: 400 },
    );
  }
  const dry_run: boolean = Boolean(body?.dry_run);

  const token = await resolveGitHubToken();
  const anthropicKey = (await resolveAnthropicKey()) ?? undefined;

  // The deterministic path needs the contribai binary. There is no remote
  // fallback: the old one proxied to a Rust endpoint that was a stub, and
  // when that was absent (always) it returned 202 "queued" for work that
  // never happened. Failing loudly beats reporting a phantom success.
  if (!canDispatchLocally()) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "Deterministic dispatch is not configured — set CONTRIBAI_BIN to the contribai binary, or use the agentic path (POST /api/run/agentic).",
      },
      { status: 501 },
    );
  }

  {
    try {
      const d = startDispatch(repo_url, dry_run, "target", [], {
        token: token ?? undefined,
        anthropicKey,
        auth0UserId,
      });
      return NextResponse.json(
        {
          status: "running",
          message: `Pipeline spawned locally (dispatch ${d.id}).`,
          dispatch_id: d.id,
          repo_url,
          mode: dry_run ? "dry-run" : "live",
          queued_at: d.started_at,
          log_path: d.log_path,
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
}
