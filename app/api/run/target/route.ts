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

  if (cloudExecution() || !canDispatchLocally()) {
    return NextResponse.json(
      {
        status: "error",
        message: "Deterministic dispatch is local-only. Use POST /api/run/agentic in hosted deployments.",
      },
      { status: 501 },
    );
  }

  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  if (typeof body.repo_url !== "string") {
    return NextResponse.json(
      { status: "error", message: "Missing required field: repo_url" },
      { status: 400 },
    );
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return NextResponse.json({ status: "error", message: "dry_run must be a boolean" }, { status: 400 });
  }
  const dry_run = body.dry_run === true;
  let repo_url: string;
  try {
    repo_url = `https://github.com/${parseRunTarget(body.repo_url).repo}`;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid GitHub repository URL" }, { status: 400 });
  }

  // The deterministic path needs the contribai binary. There is no remote
  // fallback: the old one proxied to a Rust endpoint that was a stub, and
  // when that was absent (always) it returned 202 "queued" for work that
  // never happened. Failing loudly beats reporting a phantom success.
  const token = await resolveGitHubToken();
  const anthropicKey = (await resolveAnthropicKey()) ?? undefined;

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
    } catch {
      return NextResponse.json(
        { status: "error", message: "Could not start the local target worker. Check the server configuration." },
        { status: 503 },
      );
    }
  }
}
