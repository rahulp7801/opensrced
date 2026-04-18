import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/lib/api";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";

export async function POST(req: NextRequest) {
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

  // Prefer local subprocess execution — the Rust backend's trigger_target is a stub.
  if (canDispatchLocally()) {
    try {
      const d = startDispatch(repo_url, dry_run, "target", [], { token: token ?? undefined, anthropicKey });
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

  // Fallback: proxy to the Rust stub (just logs, doesn't actually run).
  const upstream = await proxy<unknown>("/api/run/target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (upstream) return NextResponse.json(upstream, { status: 202 });

  return NextResponse.json(
    {
      status: "accepted",
      message: `Targeted run queued for ${repo_url} (no dispatcher configured — this is a no-op).`,
      repo_url,
      queued_at: new Date().toISOString(),
      mode: dry_run ? "dry-run" : "live",
    },
    { status: 202 },
  );
}
