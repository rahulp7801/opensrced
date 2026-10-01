import { readJsonBody } from "@/lib/request-body";
// POST /api/crucible/run/agentic
// Crucible's private-repo variant of /api/run/agentic. Pre-resolves the
// installation token for the caller's verified org and hands it (plus the
// orgCtx) to startAgenticDispatch so Phase 3 plumbing picks it up.

import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { CapacityError } from "@/lib/concurrency";
import { RunTargetError, startAgenticDispatch, startFindingDispatch } from "@/lib/agentic-dispatcher";
import { mappingForRequest, resolveRunTokenForRequest } from "@/lib/crucible/tokens";
import { resolveCommitAuthor } from "@/lib/github-token";
import { resolveAnthropicKey, resolveGeminiKey, resolveMaxSpendUsd } from "@/lib/api-keys";

import { cloudExecution } from "@/lib/cloud-run-state";
import { startCloudRun } from "@/lib/cloud-runs";
import { parseRunTarget } from "@/lib/run-target";

// startCloudRun's bounded steps (capacity reads, record writes, Sandbox.create,
// protocol check, launch) can exceed 120s; a kill mid-start strands the lease.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) {
    return NextResponse.json({ status: "error", message: "unauthenticated" }, { status: 401 });
  }

  const body = ((await readJsonBody(req)) ?? {}) as {
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
  const { repo_url, issue_number, github_org, kind, finding } = body ?? {};
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

  let canonicalRepoUrl: string;
  try {
    const target = parseRunTarget(repo_url);
    canonicalRepoUrl = `https://github.com/${target.repo}`;
    if (typeof github_org !== "string" || target.repo.split("/")[0].toLowerCase() !== github_org.toLowerCase()) throw new Error("Repository must belong to the connected organization.");
    if (!isSecurityFinding && (!Number.isSafeInteger(issue_number) || issue_number! < 1)) throw new Error("Invalid issue number.");
    if (isSecurityFinding && (typeof finding?.id !== "string" || finding.id.length > 200 || finding.kind !== kind || Buffer.byteLength(JSON.stringify(finding)) > 50_000)) throw new Error("Invalid security finding.");
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }

  const mapping = await mappingForRequest(sub, github_org);
  if (!mapping) {
    return NextResponse.json({ status: "error", message: "org not connected" }, { status: 404 });
  }

  // Fresh, single-repository token: the run and its VM never hold access to
  // the rest of the installation.
  const resolved = await resolveRunTokenForRequest({ auth0UserId: sub, githubOrg: github_org }, canonicalRepoUrl.split("/").pop()!);
  if (!resolved.token) {
    return NextResponse.json(
      { status: "error", message: "could not mint installation token" },
      { status: 502 },
    );
  }
  // The installation token pushes, but the commit names the admin who asked.
  const author = await resolveCommitAuthor(req.signal).catch(() => null);
  if (!author) {
    return NextResponse.json({ status: "error", message: "Sign in with GitHub again before starting this run." }, { status: 401 });
  }

  try {
    const anthropicKey = await resolveAnthropicKey();
    if (!anthropicKey) {
      return NextResponse.json(
        { status: "error", message: "No Anthropic API key configured. Add one in Settings → AI providers." },
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
      author,
    };
    const d = await (cloudExecution()
      ? startCloudRun(canonicalRepoUrl, issue_number ?? 0, sharedOpts, isSecurityFinding ? finding : undefined)
      : isSecurityFinding
      ? startFindingDispatch(canonicalRepoUrl, finding!, sharedOpts)
      : startAgenticDispatch(canonicalRepoUrl, issue_number!, sharedOpts));
    const label = isSecurityFinding
      ? `${finding!.kind} ${finding!.id}`
      : `issue #${issue_number}`;
    return NextResponse.json(
      {
        status: "running",
        message: `Crucible agentic solve spawned for ${canonicalRepoUrl} ${label} (dispatch ${d.id}).`,
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
    if (err instanceof RunTargetError) return NextResponse.json({ status: "error", message: err.message }, { status: 400 });
    const capacity = err instanceof CapacityError;
    return NextResponse.json(
      { status: "error", message: capacity ? err.message : "Could not start the private-repository worker. Check the server configuration and try again." },
      { status: capacity ? 429 : 503 },
    );
  }
}
