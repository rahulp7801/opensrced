// Runs inside a disposable push VM (lib/cloud-publish.ts): opens the draft PR
// from the run's frozen preview, as the user, with GitHub-only egress. The
// user confirmed this exact patch and text on the run page; nothing is
// regenerated here.
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { prepareRepo } = require('../.worker-build/lib/exec-run');
const { createDraftPrFromLog } = require('../.worker-build/lib/agentic-pr');

async function main() {
  const { job, token } = JSON.parse(process.env.OPENSRCER_PUBLISH);
  delete process.env.OPENSRCER_PUBLISH;
  // The upstream checkout the PR branch is cut from (same cache as the MCP tools).
  await prepareRepo(job.repo, token);
  const logPath = path.join(mkdtempSync(path.join(tmpdir(), 'opensrcer-publish-')), 'publish.log');
  writeFileSync(logPath, '');
  const result = await createDraftPrFromLog({
    repoFull: job.repo, issueNumber: job.issueNumber, logPath, dispatchId: job.dispatchId,
    findingId: job.findingId, token, author: job.author, stored: job.stored,
  });
  process.stdout.write(`${JSON.stringify(result.ok ? { ok: true, url: result.url, tests: result.tests } : { ok: false, reason: result.reason.slice(0, 500) })}\n`);
  if (!result.ok) process.exitCode = 1;
}
main().catch(() => {
  process.stdout.write(`${JSON.stringify({ ok: false, reason: 'Publishing failed. Check repository access and retry.' })}\n`);
  process.exitCode = 1;
});
