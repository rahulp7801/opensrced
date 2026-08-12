// POST /api/crucible/run/agentic
// Crucible's private-repo variant of /api/run/agentic. Pre-resolves the
// installation token for the caller's verified org and hands it (plus the
// orgCtx) to startAgenticDispatch so Phase 3 plumbing picks it up.

import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { startAgenticDispatch, startFindingDispatch } from "@/lib/agentic-dispatcher";
import { mappingForOrg } from "@/lib/crucible/orgs";
import { resolveGithubToken } from "@/lib/crucible/tokens";
import { resolveAnthropicKey, resolveGeminiKey, resolveMaxSpendUsd } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) {
    return NextResponse.json({ status: "error", message: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    repo_url?: string;
    issue_number?: number;
    github_org?: string;
    kind?: "issue" | "advisory" | "dependabot";
    finding?: {
      id: string;
      kind: string;
      summary?: string;
      description?: string;
      cve_id?: string;
      affected_package?: string;
      affected_versions?: string;
    };
  };
  const { repo_url, issue_number, github_org, kind, finding } = body;
  if (!repo_url || !github_org) {
    return NextResponse.json(
      { status: "error", message: "Missing required fields: repo_url, github_org" },
      { status: 400 },
    );
  }
  const isSecurityFinding = kind === "advisory" || kind === "dependabot";
  if (!isSecurityFinding && !issue_number) {
    return NextResponse.json(
      { status: "error", message: "Missing issue_number for issue-type dispatch" },
      { status: 400 },
    );
  }
  if (isSecurityFinding && !finding) {
    return NextResponse.json(
      { status: "error", message: "Missing finding details for advisory/dependabot dispatch" },
      { status: 400 },
    );
  }

  const mapping = mappingForOrg(sub, github_org);
  if (!mapping) {
    return NextResponse.json({ status: "error", message: "org not connected" }, { status: 404 });
  }

  const resolved = await resolveGithubToken({ auth0UserId: sub, githubOrg: github_org });
  if (!resolved.token) {
    return NextResponse.json(
      { status: "error", message: "could not mint installation token" },
      { status: 502 },
    );
  }

  try {
    const anthropicKey = await resolveAnthropicKey();
    if (!anthropicKey) {
      return NextResponse.json(
        { status: "error", message: "No Anthropic API key configured. Add one in Crucible → API Keys." },
        { status: 400 },
      );
    }
    const geminiKey = (await resolveGeminiKey()) ?? undefined;
    const maxSpendUsd = await resolveMaxSpendUsd();
    const sharedOpts = {
      token: resolved.token,
      orgCtx: { auth0UserId: sub, githubOrg: github_org },
      anthropicKey,
      geminiKey,
      maxSpendUsd,
      // Owner of the resulting dispatch. Crucible logs carry private-repo
      // source and diffs, so this is the field that keeps them out of other
      // users' /api/dispatches listings.
      auth0UserId: sub,
    };
    const d = isSecurityFinding
      ? startFindingDispatch(repo_url, finding!, sharedOpts)
      : startAgenticDispatch(repo_url, issue_number!, sharedOpts);
    const label = isSecurityFinding
      ? `${finding!.kind} ${finding!.id}`
      : `issue #${issue_number}`;
    return NextResponse.json(
      {
        status: "running",
        message: `Crucible agentic solve spawned for ${repo_url} ${label} (dispatch ${d.id}).`,
        dispatch_id: d.id,
        mode: "agentic",
        issue_number: issue_number ?? null,
        finding_id: finding?.id ?? null,
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
