import { NextRequest, NextResponse } from "next/server";
import { canDispatchLocally, startDispatch } from "@/lib/dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/require-session";

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const body = await req.json().catch(() => ({}));
  const dry_run: boolean = Boolean(body?.dry_run ?? true);
  const rounds = Number(body?.rounds ?? 1);
  const language: string | undefined = body?.language;

  if (!canDispatchLocally()) {
    return NextResponse.json(
      { status: "error", message: "Local dispatcher not configured (CONTRIBAI_BIN unset)." },
      { status: 400 },
    );
  }

  const extra = ["-r", String(rounds)];
  if (language) extra.push("-l", language);

  const token = await resolveGitHubToken();
  const anthropicKey = (await resolveAnthropicKey()) ?? undefined;

  try {
    const d = startDispatch("", dry_run, "hunt", extra, { token: token ?? undefined, anthropicKey });
    return NextResponse.json(
      {
        status: "running",
        message: `Hunt pipeline spawned (dispatch ${d.id}). Will discover repos matching discovery.stars_range in config.yaml.`,
        dispatch_id: d.id,
        mode: "hunt",
        dry_run,
        rounds,
        language,
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
