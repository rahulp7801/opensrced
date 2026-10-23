// The PR follow-up loop as the PR page drives it (lib/pr-lifecycle.ts holds
// the events and the git mechanics). For a PR one of the user's own runs
// opened:
//   - a read-only poll on each page view records events (CI failed, review
//     comments, conflicts);
//   - "Help me with follow-ups" is a per-PR opt-in, off by default;
//   - "Fix CI failure" / "Address review" start an ordinary agent run pinned
//     to the PR head, which ends at the same publish gate as every run;
//   - publishing such a run pushes ONE commit to the PR's branch (never a new
//     PR) and only after the owner's confirmation. Nothing here comments:
//     replies stay drafts on the PR page.
// State: .dispatches/lifecycle/ locally, an owner-scoped Blob when hosted.

import { put } from "@vercel/blob";
import { readJson, privateJsonOptions } from "./blob-store";
import { cloudExecution, ownerPrefix } from "./cloud-run-state";
import { listCloudRunSummaries } from "./cloud-runs";
import { listAll } from "./dispatch-store";
import { parseGitHubPullUrl } from "./github-pull-url";
import {
  ciVerdict, computeEvents, fetchSnapshot, followupEvents, followupTask, initialState, linkedIssue, loadState, saveState,
  type LifecycleState, type PrRef, type PrSnapshot,
} from "./pr-lifecycle";
import type { StartAgenticOpts } from "./agentic-dispatcher";

/** Refusal with an HTTP status and a message safe to show the user. */
export class FollowupError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "FollowupError";
  }
}

export type OwnedPr = PrRef & { url: string };

/** The PR at `prUrl` if one of `owner`'s runs opened it, else null. */
export async function ownedPr(owner: string, prUrl: string): Promise<OwnedPr | null> {
  const target = parseGitHubPullUrl(prUrl);
  if (!target) return null;
  const runs = cloudExecution() ? await listCloudRunSummaries(owner, 50) : listAll(owner);
  const opened = runs.some((r) => r.pr_url?.toLowerCase() === target.url.toLowerCase());
  return opened ? { repo: target.repoFull, number: target.prNumber, url: target.url } : null;
}

function lifecycleBlobPath(owner: string, pr: PrRef): string {
  return `${ownerPrefix(owner).slice(0, -"runs/".length)}lifecycle/${pr.repo.replace("/", "__")}__${pr.number}.json`;
}

export async function loadFollowupState(owner: string, pr: PrRef): Promise<LifecycleState> {
  if (!cloudExecution()) return loadState(pr);
  const stored = await readJson<LifecycleState>(lifecycleBlobPath(owner, pr), 200_000);
  const value = stored?.value;
  // Only this app writes the blob; still, a wrong shape starts over.
  return value && value.pr?.repo === pr.repo && value.pr.number === pr.number && Array.isArray(value.seen_comment_ids) ? value : initialState(pr);
}

export async function saveFollowupState(owner: string, state: LifecycleState): Promise<void> {
  if (!cloudExecution()) return saveState(state);
  await put(lifecycleBlobPath(owner, state.pr), JSON.stringify(state), { ...privateJsonOptions, allowOverwrite: true, abortSignal: AbortSignal.timeout(15_000) });
}

export type FollowupView = {
  pr_url: string;
  followups: boolean;
  state: "open" | "closed" | "merged";
  ci: ReturnType<typeof ciVerdict>;
  mergeable_state: string | null;
  linked_issue: number;
  recent: NonNullable<LifecycleState["recent"]>;
  pending_replies: number;
  can_fix_ci: boolean;
  can_address_review: boolean;
};

export function followupView(pr: OwnedPr, snapshot: PrSnapshot, state: LifecycleState): FollowupView {
  const open = snapshot.state === "open" && !snapshot.merged;
  const ready = open && state.followups && linkedIssue(snapshot.body) > 0;
  return {
    pr_url: pr.url,
    followups: state.followups,
    state: snapshot.merged ? "merged" : snapshot.state,
    ci: ciVerdict(snapshot.checks),
    mergeable_state: snapshot.mergeable_state,
    linked_issue: linkedIssue(snapshot.body),
    recent: state.recent ?? [],
    pending_replies: state.pending_replies.length,
    can_fix_ci: ready && followupEvents("ci", state.recent, snapshot.head_sha).length > 0,
    can_address_review: ready && followupEvents("review", state.recent, snapshot.head_sha).length > 0,
  };
}

async function requireOwned(owner: string, prUrl: string): Promise<OwnedPr> {
  const pr = await ownedPr(owner, prUrl);
  if (!pr) throw new FollowupError(404, "not found");
  return pr;
}

/** Poll GitHub once (read-only), record new events, return the page's view. */
export async function pollFollowups(owner: string, prUrl: string, token: string | undefined): Promise<FollowupView> {
  const pr = await requireOwned(owner, prUrl);
  const snapshot = await fetchSnapshot(pr, token);
  const { next } = computeEvents(snapshot, await loadFollowupState(owner, pr));
  next.last_polled_at = new Date().toISOString();
  await saveFollowupState(owner, next);
  return followupView(pr, snapshot, next);
}

export async function setFollowupOptIn(owner: string, prUrl: string, enabled: boolean): Promise<boolean> {
  const pr = await requireOwned(owner, prUrl);
  const state = { ...(await loadFollowupState(owner, pr)), followups: enabled };
  await saveFollowupState(owner, state);
  return state.followups;
}

type StartRun = (repoUrl: string, issue: number, opts: StartAgenticOpts) => Promise<{ id: string }>;

/** Start a follow-up agent run on the PR's head. `base` carries the caller's
 *  payment, keys and identity, exactly as a normal live run. */
export async function startFollowupRun(
  owner: string, prUrl: string, kind: "ci" | "review", token: string, base: StartAgenticOpts, start: StartRun,
): Promise<{ id: string }> {
  const pr = await requireOwned(owner, prUrl);
  const state = await loadFollowupState(owner, pr);
  if (!state.followups) throw new FollowupError(409, "Turn on \"Help me with follow-ups\" for this PR first.");
  const snapshot = await fetchSnapshot(pr, token);
  if (snapshot.state !== "open" || snapshot.merged) throw new FollowupError(409, "This PR is no longer open.");
  const issue = linkedIssue(snapshot.body);
  if (!issue) throw new FollowupError(409, "The PR description names no issue (\"Fixes #N\"), so there is nothing to start from.");
  const task = followupTask(followupEvents(kind, state.recent, snapshot.head_sha));
  if (!task) throw new FollowupError(409, kind === "ci" ? "No failed CI check is recorded for the PR's current head." : "No review comment asking for a change is recorded.");
  return start(`https://github.com/${pr.repo}`, issue, {
    ...base, token, dryRun: false, repoRef: snapshot.head_sha, followupPr: pr.url,
    notes: `You are updating your own open pull request #${pr.number} (${pr.url}); its changes are already in the checkout. ` +
      `Make the smallest change that addresses what follows; do not redo or revert the original fix.\n\n${task}`.slice(0, 5000),
  });
}
