import { NextRequest, NextResponse } from "next/server";
import { startAgenticDispatch } from "@/lib/agentic-dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey, resolveGeminiKey, resolveMaxSpendUsd } from "@/lib/api-keys";
import { sessionUserId } from "@/lib/require-session";

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const repo_url: string | undefined = body?.repo_url;
  const issue_number: number | undefined =
    typeof body?.issue_number === "number" ? body.issue_number : undefined;

  if (!repo_url || !issue_number) {
    return NextResponse.json(
      { status: "error", message: "Missing required fields: repo_url, issue_number" },
      { status: 400 },
    );
  }

  // Resolve the logged-in user's GitHub token from their Auth0 session so
  // the agentic child process — and the auto-PR hook after it — authenticate
  // as THEM. There is no env or gh-keychain fallback; see lib/github-token.ts.
  const token = await resolveGitHubToken();
  const anthropicKey = await resolveAnthropicKey();
  if (!anthropicKey) {
    return NextResponse.json(
      { status: "error", message: "No Anthropic API key configured. Add one in Crucible → API Keys." },
      { status: 400 },
    );
  }

  try {
    const geminiKey = (await resolveGeminiKey()) ?? undefined;
    const maxSpendUsd = await resolveMaxSpendUsd();
    const d = startAgenticDispatch(repo_url, issue_number, {
      token: token ?? undefined,
      anthropicKey,
      geminiKey,
      maxSpendUsd,
      auth0UserId,
    });
    return NextResponse.json(
      {
        status: "running",
        message: `Agentic solve spawned for ${repo_url} issue #${issue_number} (dispatch ${d.id}).`,
        dispatch_id: d.id,
        mode: "agentic",
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
