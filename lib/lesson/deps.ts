// The real collaborators behind the lesson routes (lib/lesson/api.ts).

import { getStoredKeys, resolveAnthropicKey, resolveOpenRouterKey } from "../api-keys";
import { cloudExecution } from "../cloud-run-state";
import { getCloudRun } from "../cloud-runs";
import { getDispatch, readLog } from "../dispatcher";
import { resolveCommitAuthor, resolveGitHubToken } from "../github-token";
import { getDb } from "../db/client";
import { flagEnabled } from "../flags";
import { recordLessonFinished } from "../record/standing";
import { githubApi } from "../github-api";
import { revealHiddenRun } from "../hidden-runs";
import { sessionUserId } from "../require-session";
import { loadOwnedRun } from "../run-change";
import { teacherProviders } from "../run-payment";
import { startIssueRun } from "../run-start";
import { siteUrl } from "../site-url";
import type { LessonDeps } from "./api";
import { answerKeyStatus, defaultContextDeps, loadLessonContext } from "./context";
import { lessonStore } from "./db-store";
import { chooseRuntime } from "./runtime";

export function defaultLessonDeps(): LessonDeps {
  return {
    owner: sessionUserId,
    store: lessonStore(),
    // A lesson's hidden fix is a live run: it ends at the publish gate like any other.
    startRun: ({ repoUrl, issueNumber, owner, signal }) => startIssueRun({ repoUrl, issueNumber, auth0UserId: owner, hidden: true, signal }),
    runState: async (owner, runId) => {
      if (cloudExecution()) {
        const run = await getCloudRun(owner, runId);
        return run ? { status: run.status, log: run.log } : null;
      }
      const run = getDispatch(runId, owner);
      return run ? { status: run.status, log: readLog(runId) } : null;
    },
    keyStatus: async (lesson) => {
      const found = await loadOwnedRun(lesson.owner, lesson.run_id);
      return answerKeyStatus(found?.run ?? null, found?.stored ?? null);
    },
    context: async (lesson) => loadLessonContext(lesson, defaultContextDeps(await resolveGitHubToken())),
    runtime: async () => {
      const [gitHubToken, anthropicKey, openRouterKey, keys] = await Promise.all([resolveGitHubToken(), resolveAnthropicKey(), resolveOpenRouterKey(), getStoredKeys()]);
      // The user's order, minus any plan: a Claude plan never powers the teacher (PLAN §0.6).
      return chooseRuntime({ gitHubToken, anthropicKey, openRouterKey }, { siteUrl: siteUrl(), order: teacherProviders(keys) });
    },
    reveal: revealHiddenRun,
    // The step is already saved: a record that fails to write is logged, not a failed step.
    finished: async (lesson) => {
      if (!flagEnabled("record")) return;
      try {
        const author = await resolveCommitAuthor();
        if (author) await recordLessonFinished(await getDb(), lesson.owner, author.login, lesson);
      } catch (error) {
        console.error("[record] could not record the finished lesson", lesson.id, error);
      }
    },
    headSha: async (repo, signal) => (await githubApi<{ sha: string }>(`/repos/${repo}/commits/HEAD`, await resolveGitHubToken(), undefined, signal)).sha,
  };
}
