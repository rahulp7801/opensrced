// PR lifecycle loop for PRs opensrcer opened: poll CI and review activity,
// turn changes into events, and act on them within what the user allowed.
//
//   - review comments / change requests -> recorded for the PR page, where
//     replies are DRAFTED and only posted when the user clicks (never here)
//   - CI failure or a change request    -> with follow-ups opted in for this
//     PR: a follow-up agent run on the PR branch; its patch is pushed to the
//     user's fork branch only if its verification did not fail
//   - merge conflict                    -> with follow-ups opted in: rebase
//     the fork branch onto the base and force-push with lease
//
// Nothing here posts a comment, and nothing touches a PR without its opt-in.
// State lives in .dispatches/lifecycle/<owner>__<repo>__<n>.json.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { gitAuthArgs, redactGitCredentials } from "./git-auth";
import { githubApi } from "./github-api";

const exec = promisify(execFile);

export type PrRef = { repo: string; number: number };

export type CheckResult = { name: string; state: "success" | "failure" | "pending" | "neutral"; url: string };

export type PrSnapshot = {
  state: "open" | "closed";
  merged: boolean;
  author: string;
  head_sha: string;
  head_ref: string;
  head_repo: string | null;
  base_ref: string;
  mergeable_state: string | null;
  checks: CheckResult[];
  comments: Array<{ id: number; kind: "review" | "issue" | "review_summary"; author: string; body: string; url: string; path?: string; line?: number; changes_requested?: boolean; created_at: string }>;
};

export type LifecycleEvent =
  | { kind: "ci_failed"; head_sha: string; checks: CheckResult[] }
  | { kind: "ci_passed"; head_sha: string }
  | { kind: "comment"; id: number; author: string; body: string; url: string; path?: string; line?: number; changes_requested: boolean }
  | { kind: "conflict"; head_sha: string }
  | { kind: "merged" }
  | { kind: "closed" };

export type LifecycleState = {
  pr: PrRef;
  /** Per-PR opt-in for follow-up pushes and rebases. Off by default. */
  followups: boolean;
  seen_comment_ids: number[];
  ci_notified: Record<string, "failed" | "passed">;
  conflict_notified_sha?: string;
  terminal?: "merged" | "closed";
  /** Comments waiting for a reply the user drafts and posts on the PR page. */
  pending_replies: Array<{ id: number; author: string; url: string; body: string }>;
  last_polled_at?: string;
};

export function initialState(pr: PrRef): LifecycleState {
  return { pr, followups: false, seen_comment_ids: [], ci_notified: {}, pending_replies: [] };
}

/** Collapse check runs and commit statuses into one verdict per name. */
export function ciVerdict(checks: CheckResult[]): "failed" | "passed" | "pending" | "none" {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.state === "failure")) return "failed";
  if (checks.some((c) => c.state === "pending")) return "pending";
  return "passed";
}

/** New events since `state`, and the state after recording them. Pure. */
export function computeEvents(snap: PrSnapshot, state: LifecycleState): { events: LifecycleEvent[]; next: LifecycleState } {
  const events: LifecycleEvent[] = [];
  const next: LifecycleState = { ...state, seen_comment_ids: [...state.seen_comment_ids], ci_notified: { ...state.ci_notified }, pending_replies: [...state.pending_replies] };
  if (snap.merged || snap.state === "closed") {
    const terminal = snap.merged ? "merged" : "closed";
    if (state.terminal !== terminal) events.push({ kind: terminal });
    next.terminal = terminal;
    return { events, next };
  }
  const verdict = ciVerdict(snap.checks);
  if ((verdict === "failed" || verdict === "passed") && next.ci_notified[snap.head_sha] !== verdict) {
    next.ci_notified[snap.head_sha] = verdict;
    events.push(verdict === "failed"
      ? { kind: "ci_failed", head_sha: snap.head_sha, checks: snap.checks.filter((c) => c.state === "failure") }
      : { kind: "ci_passed", head_sha: snap.head_sha });
  }
  if (snap.mergeable_state === "dirty" && state.conflict_notified_sha !== snap.head_sha) {
    next.conflict_notified_sha = snap.head_sha;
    events.push({ kind: "conflict", head_sha: snap.head_sha });
  }
  for (const c of snap.comments) {
    if (next.seen_comment_ids.includes(c.id)) continue;
    next.seen_comment_ids.push(c.id);
    // The user's own comments and empty review summaries need no reply.
    if (c.author.toLowerCase() === snap.author.toLowerCase() || (!c.body.trim() && !c.changes_requested)) continue;
    events.push({ kind: "comment", id: c.id, author: c.author, body: c.body, url: c.url, path: c.path, line: c.line, changes_requested: Boolean(c.changes_requested) });
    next.pending_replies.push({ id: c.id, author: c.author, url: c.url, body: c.body.slice(0, 2000) });
  }
  next.seen_comment_ids = next.seen_comment_ids.slice(-1000);
  return { events, next };
}

type GhCheckRun = { name: string; status: string; conclusion: string | null; html_url: string };
type GhStatus = { context: string; state: string; target_url: string | null };

function checkState(status: string, conclusion: string | null): CheckResult["state"] {
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "success";
  if (conclusion === "neutral" || conclusion === "skipped") return "neutral";
  return "failure"; // failure, timed_out, cancelled, action_required, stale
}

/** Read-only: one PR's current state from the GitHub API. */
export async function fetchSnapshot(pr: PrRef, token: string | undefined, signal?: AbortSignal): Promise<PrSnapshot> {
  const base = `/repos/${pr.repo}`;
  const p = await githubApi<{
    state: "open" | "closed"; merged: boolean; mergeable_state?: string | null; user: { login: string };
    head: { sha: string; ref: string; repo: { full_name: string } | null }; base: { ref: string };
  }>(`${base}/pulls/${pr.number}`, token, undefined, signal);
  const [runs, statuses, reviewComments, issueComments, reviews] = await Promise.all([
    githubApi<{ check_runs: GhCheckRun[] }>(`${base}/commits/${p.head.sha}/check-runs?per_page=100`, token, undefined, signal),
    githubApi<{ statuses: GhStatus[] }>(`${base}/commits/${p.head.sha}/status`, token, undefined, signal),
    githubApi<Array<{ id: number; user: { login: string } | null; body: string; html_url: string; path?: string; line?: number | null; created_at: string }>>(`${base}/pulls/${pr.number}/comments?per_page=100`, token, undefined, signal),
    githubApi<Array<{ id: number; user: { login: string } | null; body: string; html_url: string; created_at: string }>>(`${base}/issues/${pr.number}/comments?per_page=100`, token, undefined, signal),
    githubApi<Array<{ id: number; user: { login: string } | null; body: string | null; html_url: string; state: string; submitted_at: string }>>(`${base}/pulls/${pr.number}/reviews?per_page=100`, token, undefined, signal),
  ]);
  // The newest status per context wins (the API lists newest first).
  const latest = new Map<string, GhStatus>();
  for (const s of statuses.statuses) if (!latest.has(s.context)) latest.set(s.context, s);
  return {
    state: p.state, merged: p.merged, author: p.user.login, head_sha: p.head.sha, head_ref: p.head.ref,
    head_repo: p.head.repo?.full_name ?? null, base_ref: p.base.ref, mergeable_state: p.mergeable_state ?? null,
    checks: [
      ...runs.check_runs.map((r) => ({ name: r.name, state: checkState(r.status, r.conclusion), url: r.html_url })),
      ...[...latest.values()].map((s) => ({ name: s.context, state: s.state === "success" ? "success" as const : s.state === "pending" ? "pending" as const : "failure" as const, url: s.target_url ?? "" })),
    ],
    comments: [
      ...reviewComments.map((c) => ({ id: c.id, kind: "review" as const, author: c.user?.login ?? "ghost", body: c.body, url: c.html_url, path: c.path, line: c.line ?? undefined, created_at: c.created_at })),
      ...issueComments.map((c) => ({ id: c.id, kind: "issue" as const, author: c.user?.login ?? "ghost", body: c.body, url: c.html_url, created_at: c.created_at })),
      ...reviews.filter((r) => r.state !== "PENDING").map((r) => ({ id: r.id, kind: "review_summary" as const, author: r.user?.login ?? "ghost", body: r.body ?? "", url: r.html_url, changes_requested: r.state === "CHANGES_REQUESTED", created_at: r.submitted_at })),
    ],
  };
}

// ── State store ────────────────────────────────────────────────────────

function stateFile(pr: PrRef): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(pr.repo) || !Number.isSafeInteger(pr.number) || pr.number < 1) throw new Error("invalid PR reference");
  return path.join(process.cwd(), ".dispatches", "lifecycle", `${pr.repo.replace("/", "__")}__${pr.number}.json`);
}

export async function loadState(pr: PrRef): Promise<LifecycleState> {
  try { return JSON.parse(await readFile(stateFile(pr), "utf8")) as LifecycleState; }
  catch { return initialState(pr); }
}

export async function saveState(state: LifecycleState): Promise<void> {
  const file = stateFile(state.pr);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 1), { mode: 0o600 });
}

/** Per-PR opt-in for follow-up pushes and rebases. */
export async function setFollowups(pr: PrRef, enabled: boolean): Promise<LifecycleState> {
  const state = { ...(await loadState(pr)), followups: enabled };
  await saveState(state);
  return state;
}

/** Poll once and persist. Read-only on GitHub. */
export async function pollOnce(pr: PrRef, token: string | undefined): Promise<{ events: LifecycleEvent[]; state: LifecycleState; snapshot: PrSnapshot }> {
  const snapshot = await fetchSnapshot(pr, token);
  const { events, next } = computeEvents(snapshot, await loadState(pr));
  next.last_polled_at = new Date().toISOString();
  await saveState(next);
  return { events, state: next, snapshot };
}

// ── Rebase (opt-in) ────────────────────────────────────────────────────

export type RebaseResult = { ok: true; sha: string } | { ok: false; conflict: boolean; reason: string };

/** Rebase `branch` of `headUrl` onto `baseRef` of `baseUrl` and push it back
 *  with --force-with-lease. A conflicting rebase is aborted, never forced.
 *  URLs are parameters so tests can use local bare repositories; callers
 *  pass https://github.com/<repo>.git. Isolated git config: no host hooks,
 *  no credential helper, one-shot auth header. */
export async function rebaseBranch(opts: {
  headUrl: string; branch: string; baseUrl: string; baseRef: string; token?: string;
  author: { name: string; email: string };
}): Promise<RebaseResult> {
  const root = await mkdtemp(path.join(tmpdir(), "opensrcer-rebase-"));
  const repo = path.join(root, "repo");
  const hooks = path.join(root, "hooks");
  const config = path.join(root, "gitconfig");
  try {
    await mkdir(hooks);
    await writeFile(config, "");
    const env = childEnv({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" });
    const auth = gitAuthArgs(opts.token);
    const git = async (args: string[]) => (await exec("git", ["-c", `core.hooksPath=${hooks}`, "-c", `user.name=${opts.author.name}`, "-c", `user.email=${opts.author.email}`, ...args], { env, timeout: 120_000, maxBuffer: 10_000_000, windowsHide: true })).stdout.trim();
    await git([...auth, "clone", "--quiet", "--single-branch", "--branch", opts.branch, opts.headUrl, repo]);
    const before = await git(["-C", repo, "rev-parse", "HEAD"]);
    await git([...auth, "-C", repo, "fetch", "--quiet", opts.baseUrl, `${opts.baseRef}:refs/remotes/base/${opts.baseRef}`]);
    try {
      await git(["-C", repo, "rebase", `refs/remotes/base/${opts.baseRef}`]);
    } catch (error) {
      await git(["-C", repo, "rebase", "--abort"]).catch(() => "");
      return { ok: false, conflict: true, reason: `rebase onto ${opts.baseRef} conflicts; resolve it by hand (${redactGitCredentials(error instanceof Error ? error.message : String(error)).split("\n").find((l) => /CONFLICT/.test(l)) ?? "conflict"})` };
    }
    const after = await git(["-C", repo, "rev-parse", "HEAD"]);
    if (after === before) return { ok: true, sha: after };
    await git([...auth, "-C", repo, "push", "--quiet", `--force-with-lease=${opts.branch}:${before}`, "origin", `HEAD:refs/heads/${opts.branch}`]);
    return { ok: true, sha: after };
  } catch (error) {
    return { ok: false, conflict: false, reason: redactGitCredentials(error instanceof Error ? error.message : String(error)).slice(0, 500) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The follow-up agent's task, from the events that triggered it. The
 *  reviewer/CI text is untrusted and fenced like an issue body. */
export function followupTask(events: LifecycleEvent[]): string | null {
  const parts: string[] = [];
  for (const e of events) {
    if (e.kind === "ci_failed") parts.push(`CI failed on ${e.head_sha.slice(0, 12)}: ${e.checks.map((c) => `${c.name} (${c.url})`).join(", ")}. Reproduce the failing check locally if you can and fix the cause.`);
    if (e.kind === "comment" && (e.changes_requested || e.path)) parts.push(`A reviewer (${e.author}) commented${e.path ? ` on ${e.path}${e.line ? `:${e.line}` : ""}` : ""}:\n<review-comment untrusted="true">\n${e.body.slice(0, 3000)}\n</review-comment>`);
  }
  return parts.length ? parts.join("\n\n") : null;
}
