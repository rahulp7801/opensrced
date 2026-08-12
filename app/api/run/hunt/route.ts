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
  const dry_run: boolean = Boolean(body?.dry_run ?? true);
  // Both of these become argv for the contribai binary. execFile means no
  // shell, but an unvalidated string still lets a caller inject an extra
  // FLAG (`--config /etc/…`) rather than a value. Constrain the shapes.
  const rounds = Number(body?.rounds ?? 1);
  const rawLanguage: unknown = body?.language;
  const language =
    typeof rawLanguage === "string" && /^[A-Za-z][A-Za-z0-9+#.-]{0,31}$/.test(rawLanguage)
      ? rawLanguage
      : undefined;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
    return NextResponse.json(
      { status: "error", message: "rounds must be an integer between 1 and 20" },
      { status: 400 },
    );
  }

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
    const d = startDispatch("", dry_run, "hunt", extra, {
      token: token ?? undefined,
      anthropicKey,
      auth0UserId,
    });
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
