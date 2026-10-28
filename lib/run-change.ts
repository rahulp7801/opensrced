// Run mode for "Ask about this change" and the understanding check (PLAN
// §7.2): the server loads the change from the caller's own stored run and
// preview, instead of trusting a diff the browser sent. A lesson's hidden
// run is refused until the lesson reveals it.

import { join } from "node:path";
import { cloudExecution } from "./cloud-run-state";
import { getCloudRun } from "./cloud-runs";
import { getCloudPreview } from "./cloud-publish";
import { getDispatch, type Dispatch } from "./dispatcher";
import { EXPLAIN_LIMITS, clean, previewChangeContext, type RunRef, type ServerChange } from "./explain";
import { HIDDEN_RUN_MESSAGE, hiddenRunLocked } from "./hidden-runs";
import { readPreview } from "./pr-preview";
import type { StoredPreview } from "./publish";
import { sanitizeRepoId } from "./sanitize";
import { lessonStore } from "./lesson/store";

/** The caller's run and its frozen preview (null while there is none yet).
 *  Null when the run is missing or not the caller's: both read as missing. */
export async function loadOwnedRun(owner: string, runId: string): Promise<{ run: Dispatch; stored: StoredPreview | null } | null> {
  const run = cloudExecution() ? await getCloudRun(owner, runId) : getDispatch(runId, owner) ?? null;
  if (!run) return null;
  const stored = cloudExecution() ? await getCloudPreview(owner, runId) : await readPreview(join(process.cwd(), ".dispatches", runId));
  return { run, stored };
}

/** ExplainDeps.loadChange for the signed-in `owner`. */
export async function loadRunChange(owner: string | null, ref: RunRef): Promise<ServerChange | Response> {
  if (!owner) return Response.json({ error: "Not authenticated" }, { status: 401 });
  let runId: string;
  if ("lessonId" in ref) {
    const lesson = await lessonStore().get(ref.lessonId);
    if (!lesson || lesson.owner !== owner) return Response.json({ error: "not found" }, { status: 404 });
    runId = lesson.run_id;
  } else runId = ref.runId;
  const found = await loadOwnedRun(owner, runId);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  if (await hiddenRunLocked(owner, found.run)) return Response.json({ error: HIDDEN_RUN_MESSAGE }, { status: 403 });
  if (!found.stored) return Response.json({ error: "This run has no reviewed change yet." }, { status: 409 });
  const { preview, diff } = found.stored;
  const context = previewChangeContext(preview, diff);
  return {
    runId,
    change: {
      repo: sanitizeRepoId(found.run.repo_url),
      title: clean(preview.title, EXPLAIN_LIMITS.title),
      context: {
        description: clean(context.description ?? "", EXPLAIN_LIMITS.description),
        diff: clean(diff, EXPLAIN_LIMITS.diff),
        verification: clean(context.verification ?? "", EXPLAIN_LIMITS.verification),
        rules: clean(context.rules ?? "", EXPLAIN_LIMITS.rules),
      },
    },
  };
}
