// The real collaborators behind the lesson routes (lib/lesson/api.ts).

import { resolveAnthropicKey, resolveOpenRouterKey } from "../api-keys";
import { cloudExecution } from "../cloud-run-state";
import { getCloudRun } from "../cloud-runs";
import { getDispatch, readLog } from "../dispatcher";
import { resolveGitHubToken } from "../github-token";
import { revealHiddenRun } from "../hidden-runs";
import { sessionUserId } from "../require-session";
import { loadOwnedRun } from "../run-change";
import { startIssueRun } from "../run-start";
import { siteUrl } from "../site-url";
import type { LessonDeps } from "./api";
import { answerKeyStatus, defaultContextDeps, loadLessonContext } from "./context";
import { chooseRuntime } from "./runtime";
import { lessonStore } from "./store";

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
      const [gitHubToken, anthropicKey, openRouterKey] = await Promise.all([resolveGitHubToken(), resolveAnthropicKey(), resolveOpenRouterKey()]);
      return chooseRuntime({ gitHubToken, anthropicKey, openRouterKey }, { siteUrl: siteUrl() });
    },
    reveal: revealHiddenRun,
  };
}
