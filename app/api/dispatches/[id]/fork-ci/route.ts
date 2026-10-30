// POST /api/dispatches/<id>/fork-ci   run the project's own CI on the run's
//                                     published branch, inside the user's fork
// GET  /api/dispatches/<id>/fork-ci   the stored result, polled once on
//                                     GitHub while it is still running
//
// Behind OPENSRCER_FORK_CI=1 (404 otherwise, and the run page shows nothing).
// The user's GitHub token stays in this route: everything is a REST call to
// their fork (lib/fork-ci.ts); no VM that runs project code ever sees it.

import { NextResponse } from "next/server";
import { sessionUserId } from "@/lib/require-session";
import { resolveGitHubToken } from "@/lib/github-token";
import { errorStatus, GitHubApiError } from "@/lib/github-api";
import { ForkCiError, forkCiEnabled, pollRunForkCi, startRunForkCi } from "@/lib/fork-ci";

export const maxDuration = 120;

function failure(error: unknown) {
  if (error instanceof ForkCiError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof GitHubApiError) return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  return NextResponse.json({ error: "Could not check CI in your fork. Try again." }, { status: 500 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!forkCiEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ fork_ci: await pollRunForkCi(owner, id, await resolveGitHubToken()) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!forkCiEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owner = await sessionUserId();
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const token = await resolveGitHubToken();
  if (!token) return NextResponse.json({ error: "Sign in with GitHub again: CI runs in your own fork." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ fork_ci: await startRunForkCi(owner, id, token) });
  } catch (error) {
    return failure(error);
  }
}
