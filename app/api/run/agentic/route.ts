import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { startAgenticDispatch } from "@/lib/agentic-dispatcher";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveAnthropicKey, resolveGeminiKey, resolveMaxSpendUsd } from "@/lib/api-keys";
import { sessionUserId } from "@/lib/require-session";
import { parseRunTarget } from "@/lib/run-target";
import { CapacityError } from "@/lib/concurrency";
import { cloudExecution } from "@/lib/cloud-run-state";
import { startCloudRun } from "@/lib/cloud-runs";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth0UserId = await sessionUserId();
  if (!auth0UserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await readJsonBody<Record<string, unknown>>(req)) ?? {};
  const repo_url = typeof body.repo_url === "string" ? body.repo_url : undefined;
  const issue_number: number | undefined =
    typeof body?.issue_number === "number" ? body.issue_number : undefined;

  if (typeof repo_url !== "string" || !Number.isSafeInteger(issue_number) || !issue_number || issue_number < 1) {
    return NextResponse.json(
      { status: "error", message: "Missing required fields: repo_url, issue_number" },
      { status: 400 },
    );
  }

  try {
    parseRunTarget(repo_url);
  } catch {
    return NextResponse.json({ message: "Invalid GitHub repository URL" }, { status: 400 });
  }
  if ((body.dry_run !== undefined && typeof body.dry_run !== "boolean") ||
      (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 5000))) {
    return NextResponse.json({ message: "Invalid dry_run or notes" }, { status: 400 });
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
    const start = cloudExecution() ? startCloudRun : startAgenticDispatch;
    const d = await start(repo_url, issue_number, {
      token: token ?? undefined,
      anthropicKey,
      geminiKey,
      maxSpendUsd,
      auth0UserId,
      dryRun: body.dry_run === true,
      notes: body.notes,
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
      { status: err instanceof CapacityError ? 429 : 500 },
    );
  }
}
