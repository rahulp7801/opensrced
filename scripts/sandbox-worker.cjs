// Runs inside a disposable VM. Each upload token is limited to one result file.
const { put } = require('@vercel/blob/client');
const { setTimeout: delay } = require('node:timers/promises');
const { startAgenticDispatch, startFindingDispatch } = require('../.worker-build/lib/agentic-dispatcher');
const store = require('../.worker-build/lib/dispatch-store');
const { readLogSince } = require('../.worker-build/lib/dispatcher');

async function main() {
  const { run, path, summaryPath, opts, finding } = JSON.parse(process.env.OPENSRCER_JOB);
  const uploadToken = process.env.OPENSRCER_UPLOAD_TOKEN;
  const summaryUploadToken = process.env.OPENSRCER_SUMMARY_UPLOAD_TOKEN;
  delete process.env.OPENSRCER_JOB;
  delete process.env.OPENSRCER_UPLOAD_TOKEN;
  delete process.env.OPENSRCER_SUMMARY_UPLOAD_TOKEN;
  let previous = '';
  let previousSummary = '';
  let lastRecord = run;
  async function publish(record) {
    const body = JSON.stringify(record);
    if (body === previous) return;
    const summary = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'log' && key !== 'log_size'));
    const summaryBody = JSON.stringify(summary);
    for (let attempt = 0; ; attempt++) {
      try {
        await put(path, body, { access: 'private', token: uploadToken, contentType: 'application/json',
          abortSignal: AbortSignal.timeout(15000) });
        if (summaryBody !== previousSummary) {
          await put(summaryPath, summaryBody, { access: 'private', token: summaryUploadToken, contentType: 'application/json',
            abortSignal: AbortSignal.timeout(15000) });
        }
        previous = body;
        previousSummary = summaryBody;
        lastRecord = record;
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        await delay(1000 * 2 ** attempt);
      }
    }
  }
  try {
    const dispatch = await (finding ? startFindingDispatch(run.repo_url, finding, opts) : startAgenticDispatch(run.repo_url, run.issue_number, opts));
    while (Date.now() < run.expires_at - 15000) {
      await delay(3000);
      const record = store.read(dispatch.id) || dispatch;
      const log = readLogSince(dispatch.id, 0);
      const update = { ...run, ...record, id: run.id, log_path: '', log: log.chunk, log_size: log.size };
      await publish(update);
      if (record.status !== 'running' && record.pr_status !== 'pending') return;
    }
    throw new Error('Worker deadline reached');
  } catch {
    const message = '\nThe isolated worker failed. Check provider access and retry.\n';
    await publish({ ...lastRecord, status: 'failed', pr_status: 'failed', ended_at: new Date().toISOString(),
      log: lastRecord.log + message, log_size: lastRecord.log_size + Buffer.byteLength(message) });
    process.exitCode = 1;
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch(() => process.exit(1));
