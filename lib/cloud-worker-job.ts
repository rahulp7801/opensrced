import type { FindingInput, StartAgenticOpts } from "./agentic-dispatcher";
import type { CloudRun } from "./cloud-run-state";

/** Serialize only the inputs the disposable worker needs. */
export function cloudWorkerJobJson(
  run: CloudRun,
  path: string,
  summaryPath: string,
  opts: StartAgenticOpts,
  finding?: FindingInput,
): string {
  return JSON.stringify({
    run,
    path,
    summaryPath,
    finding,
    opts: {
      dryRun: opts.dryRun,
      notes: opts.notes,
      token: opts.token,
      installationToken: Boolean(opts.orgCtx),
      anthropicKey: opts.anthropicKey,
      geminiKey: opts.geminiKey,
      maxSpendUsd: opts.maxSpendUsd,
      auth0UserId: opts.auth0UserId,
    },
  });
}
