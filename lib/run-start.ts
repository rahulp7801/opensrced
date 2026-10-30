// Starting an issue run for the signed-in user: the one path both
// POST /api/run/agentic and POST /api/lessons (a hidden run) go through, so
// a lesson's hidden fix gets exactly the same guards, payment choice and
// pipeline as any other run.

import { findOpenRunPr, RunTargetError, startAgenticDispatch } from "./agentic-dispatcher";
import { resolveCommitAuthor, resolveGitHubToken, type CommitAuthor } from "./github-token";
import { resolveGeminiKey, resolveMaxSpendUsd, resolveRunPayment } from "./api-keys";
import { NoRunCredentialError, type RunPayment } from "./run-payment";
import { parseRunTarget } from "./run-target";
import { CapacityError } from "./concurrency";
import { cloudExecution } from "./cloud-run-state";
import { startCloudRun } from "./cloud-runs";
import type { Dispatch } from "./dispatcher";

/** A refusal with the HTTP status and a message safe to show. */
export class RunStartError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RunStartError";
  }
}

export type IssueRunInput = {
  /** Canonical https://github.com/<owner>/<repo>. */
  repoUrl: string;
  issueNumber: number;
  auth0UserId: string;
  dryRun?: boolean;
  notes?: string;
  /** A lesson's hidden fix (lib/hidden-runs.ts). */
  hidden?: boolean;
  signal?: AbortSignal;
};

/** Start the run, or throw RunStartError. */
export async function startIssueRun(input: IssueRunInput): Promise<Dispatch> {
  // Resolve the logged-in user's GitHub token from their Auth0 session so
  // the agentic child process — and the auto-PR hook after it — authenticate
  // as THEM. There is no env or gh-keychain fallback; see lib/github-token.ts.
  const token = await resolveGitHubToken();
  if (!token && input.dryRun !== true) {
    throw new RunStartError(401, "Sign in with GitHub before starting a live solve. GitHub access is required to open the pull request.");
  }
  // Subscription first; the API key only when ranked first or opted in as fallback.
  let payment: RunPayment;
  try { payment = await resolveRunPayment(); }
  catch (error) {
    if (!(error instanceof NoRunCredentialError)) throw error;
    throw new RunStartError(400, error.message);
  }
  // Live runs commit as the requester, never as the deployer.
  let author: CommitAuthor | undefined;
  if (input.dryRun !== true) {
    author = (await resolveCommitAuthor(input.signal).catch(() => null)) ?? undefined;
    if (!author) throw new RunStartError(401, "Sign in with GitHub again before starting a live solve.");
  }

  try {
    if (author && token) {
      const existing = await findOpenRunPr(parseRunTarget(input.repoUrl).repo, input.issueNumber, author.login, token, input.signal);
      if (existing) throw new RunTargetError(`You already have an open pull request for this issue: ${existing}. Close it before starting another live run.`);
    }
    const geminiKey = (await resolveGeminiKey()) ?? undefined;
    const maxSpendUsd = await resolveMaxSpendUsd();
    const start = cloudExecution() ? startCloudRun : startAgenticDispatch;
    return await start(input.repoUrl, input.issueNumber, {
      token: token ?? undefined,
      provider: payment.provider,
      anthropicKey: payment.anthropicKey,
      keyFallback: payment.keyFallback,
      openrouterKey: payment.openrouterKey,
      agentModel: payment.agentModel,
      geminiKey,
      maxSpendUsd,
      auth0UserId: input.auth0UserId,
      author,
      dryRun: input.dryRun === true,
      notes: input.notes,
      ...(input.hidden ? { hidden: true } : {}),
    });
  } catch (err) {
    if (err instanceof RunTargetError) throw new RunStartError(400, err.message);
    if (err instanceof CapacityError) throw new RunStartError(429, err.message);
    throw new RunStartError(503, "Could not start the worker. Check the server configuration and try again.");
  }
}
