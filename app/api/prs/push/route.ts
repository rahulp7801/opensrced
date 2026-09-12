import { readJsonBody } from "@/lib/request-body";
import { NextRequest } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";
import { sanitizeRepoId, sanitizeBranchName, sanitizeCommitMessage } from "@/lib/sanitize";
import { requireSession } from "@/lib/require-session";
import { reserveSlot, CapacityError } from "@/lib/concurrency";
import { cloudExecution } from "@/lib/cloud-run-state";
import { cloudPush } from "@/lib/cloud-push";
import { pushPrPatch } from "@/lib/pr-push";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const unauth = await requireSession();
  if (unauth) return unauth;

  const raw = ((await readJsonBody(req)) ?? {}) as {
    repo?: string;
    upstream?: string;
    branch?: string;
    diff?: string;
    commit_message?: string;
  };

  if (!raw || [raw.repo, raw.branch, raw.diff, raw.commit_message].some(value => value !== undefined && typeof value !== "string") || (typeof raw.diff === "string" && Buffer.byteLength(raw.diff) > 100_000)) return Response.json({ error: "Invalid push input or patch too large" }, { status: 400 });

  const body = {
    repo: raw.repo ? sanitizeRepoId(raw.repo) : null,
    upstream: raw.upstream ? sanitizeRepoId(raw.upstream) : null,
    branch: raw.branch ? sanitizeBranchName(raw.branch) : null,
    diff: raw.diff?.slice(0, 100_000) ?? null, // cap diff size
    commit_message: raw.commit_message ? sanitizeCommitMessage(raw.commit_message) : "address review feedback",
  };

  if (!body.repo || !body.branch || !body.diff) {
    return Response.json(
      { error: "Missing repo, branch, or diff" },
      { status: 400 },
    );
  }

  const token = await resolveGitHubToken();
  if (!token) {
    return Response.json(
      { error: "No GitHub token available. Log in first." },
      { status: 401 },
    );
  }

  let release: (() => void) | undefined;
  try {
    const input = { repo: body.repo, branch: body.branch, diff: body.diff, commit_message: body.commit_message };
    if (cloudExecution()) return Response.json(await cloudPush(input, token, req.signal));
    release = reserveSlot("push", 2);
    return Response.json(await pushPrPatch(input, token));
  } catch (error) {
    return Response.json({ error: error instanceof CapacityError ? error.message : "Push failed. Check repository access, secret scanning, and whether the branch changed." }, { status: error instanceof CapacityError ? 429 : 502 });
  } finally { release?.(); }
}
