// What a lesson's steps and teacher are graded against, loaded on the server
// (PLAN §7.2): the issue, the README, the shared code graph, and the hidden
// fix's frozen preview as the answer key. None of it is sent to the browser.

import { fetchIssue } from "../agentic-dispatcher";
import { gh } from "../gh";
import { githubText } from "../github-api";
import { maintainerPrefs, MaintainerPrefsFetchError, prefsLines } from "../maintainer-prefs";
import { getStoredGraph } from "../graph-store";
import type { StoredPreview } from "../publish";
import { loadOwnedRun } from "../run-change";
import { parseRunTarget } from "../run-target";
import { readUnderstanding } from "../understanding-record";
import type { AnswerKeyStatus } from "./machine";
import type { Lesson } from "./store";
import type { StepContext } from "./steps";

/** The answer key's status from the hidden run (§7.2): verified only when the
 *  fix passed and its new test fails without it. */
export function answerKeyStatus(run: { status: string } | null, stored: StoredPreview | null): AnswerKeyStatus {
  if (!run || run.status === "running") return "pending";
  if (run.status !== "succeeded" || !stored?.diff.trim()) return "failed";
  const v = stored.preview.verification;
  return stored.preview.executed && v?.status === "verified" && v.regression === "reproduced" ? "verified" : "unverified";
}

export type ContextDeps = {
  token: string | null;
  issue: (repo: string, number: number, token: string | null) => Promise<{ title: string; body: string }>;
  readme: (repo: string, token: string | null) => Promise<string>;
  graph: (owner: string, repo: string) => Promise<StepContext["graph"]>;
  run: typeof loadOwnedRun;
  practiced: (owner: string, runId: string) => Promise<number>;
  /** lib/maintainer-prefs.ts prefsLines for the repo; [] when they could not be read. */
  prefs: (repo: string, token: string | null) => Promise<string[]>;
};

export const README_MAX_BYTES = 200_000;

export function defaultContextDeps(token: string | null): ContextDeps {
  return {
    token,
    issue: async (repo, number, t) => fetchIssue(repo, number, t ?? undefined, true),
    // A missing README is normal; the steps cope with "".
    readme: (repo, t) => githubText(`/repos/${repo}/readme`, t, "application/vnd.github.raw", README_MAX_BYTES).catch(() => ""),
    graph: async (owner, repo) => (await getStoredGraph(owner, repo).catch(() => null))?.graph ?? null,
    run: loadOwnedRun,
    practiced: async (owner, runId) => (await readUnderstanding(owner, runId))?.practiced ?? 0,
    // The teacher manages without them; a failed read is logged, not fatal.
    prefs: async (repo, t) => {
      if (!t) return [];
      try { return prefsLines(await maintainerPrefs(gh(t), repo)); }
      catch (error) {
        if (!(error instanceof MaintainerPrefsFetchError)) throw error;
        console.warn(`[lesson] ${error.message}`);
        return [];
      }
    },
  };
}

/** Everything the steps and teacher need for `lesson`, plus the answer key's
 *  current status (which may have moved on since the lesson was saved). */
export async function loadLessonContext(lesson: Lesson, deps: ContextDeps): Promise<StepContext> {
  const repo = parseRunTarget(lesson.repo_url).repo;
  const [issue, readme, graph, found, practiced, prefs] = await Promise.all([
    deps.issue(repo, lesson.issue_number, deps.token),
    deps.readme(repo, deps.token),
    deps.graph(lesson.owner, lesson.repo_url),
    deps.run(lesson.owner, lesson.run_id),
    deps.practiced(lesson.owner, lesson.run_id),
    deps.prefs(repo, deps.token),
  ]);
  const status = answerKeyStatus(found?.run ?? null, found?.stored ?? null);
  const stored = found?.stored;
  return {
    repo,
    issue: { number: lesson.issue_number, title: issue.title, body: issue.body },
    readme,
    graph,
    answerKey: stored && (status === "verified" || status === "unverified")
      ? { diff: stored.diff, diagnosis: stored.preview.diagnosis ?? "", cases: stored.preview.cases ?? [], title: stored.preview.title }
      : null,
    answerKeyStatus: status,
    practiced,
    prefs,
  };
}
