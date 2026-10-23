// Runs inside a disposable VM. Each upload token is limited to one result file.
const { put } = require('@vercel/blob/client');
const { setTimeout: delay } = require('node:timers/promises');
const { startAgenticDispatch, startFindingDispatch, RunTargetError } = require('../.worker-build/lib/agentic-dispatcher');
const store = require('../.worker-build/lib/dispatch-store');
const { readLogTail } = require('../.worker-build/lib/dispatcher');
const { cloudRunSummary, dispatchStatsFromLog, WORKER_TIMEOUT_MS } = require('../.worker-build/lib/cloud-run-state');
const { signInInVm, HostedSignInError, SIGN_IN_CODE_DIR } = require('../.worker-build/lib/hosted-sign-in');
const { claudeStatusFrom } = require('../.worker-build/lib/run-payment');
const { childEnv } = require('../.worker-build/lib/child-env');
const { execFile } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');

/** `claude auth <args>` against this run's own config dir. */
function claudeAuth(args, env) {
  return new Promise(resolve => execFile('claude', ['auth', ...args], { env, timeout: 30000 },
    (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, out: String(stdout) })));
}

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
    const summary = cloudRunSummary(record);
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
  // Hosted subscription run: the user signs in to Claude inside this VM
  // (lib/hosted-sign-in.ts). The login lives only in this config dir.
  let loginEnv;
  try {
    if (opts.provider === 'claude-subscription') {
      const configDir = mkdtempSync('/tmp/opensrcer-claude-');
      // Default permissions: the app's writeFiles may land as another VM user.
      mkdirSync(SIGN_IN_CODE_DIR, { recursive: true });
      loginEnv = childEnv({ CLAUDE_CONFIG_DIR: configDir, BROWSER: 'none' });
      await signInInVm({
        bin: 'claude', env: loginEnv, timeoutMs: 8 * 60000,
        onUrl: url => publish({ ...lastRecord, sign_in: { url, status: 'waiting' } }),
      });
      // Trust the CLI's own status, not the login command's exit.
      const auth = await claudeAuth(['status', '--json'], loginEnv);
      const status = claudeStatusFrom(auth.code, auth.out);
      if (!status.available) throw new HostedSignInError(`Claude sign-in did not complete: ${status.detail}.`);
      await publish({ ...lastRecord, sign_in: { ...lastRecord.sign_in, status: 'signed_in' } });
      opts.claudeConfigDir = configDir;
    }
    const dispatch = await (finding ? startFindingDispatch(run.repo_url, finding, opts) : startAgenticDispatch(run.repo_url, run.issue_number, opts));
    // Stop before the VM is killed (it was created after started_at, so this
    // is conservative), leaving time to record the failure. expires_at is the
    // later 45-minute record TTL and was never reached.
    const deadline = Math.min(run.expires_at, Date.parse(run.started_at) + WORKER_TIMEOUT_MS) - 60000;
    while (Date.now() < deadline) {
      await delay(3000);
      const record = store.read(dispatch.id) || dispatch;
      // An exact file suffix: validCloudRun requires log_size >= its byte length.
      const log = readLogTail(dispatch.id);
      const update = { ...run, ...record, id: run.id, log_path: '', log: log.chunk, log_size: log.size, sign_in: lastRecord.sign_in,
        stats: dispatchStatsFromLog(log.chunk, lastRecord.stats) };
      await publish(update);
      if (record.status !== 'running' && record.pr_status !== 'pending') return;
    }
    throw new Error('Worker deadline reached');
  } catch (error) {
    // Run-target errors (missing issue, inaccessible repo, pull request number)
    // carry fixed, credential-free messages that say what to change; anything
    // else stays generic so internal details never reach the run log.
    const reason = error instanceof RunTargetError || error instanceof HostedSignInError ? error.message : 'Check provider access and retry.';
    const message = `\nThe isolated worker failed. ${reason}\n`;
    const signIn = lastRecord.sign_in && lastRecord.sign_in.status === 'waiting' ? { ...lastRecord.sign_in, status: 'failed' } : lastRecord.sign_in;
    await publish({ ...lastRecord, sign_in: signIn, status: 'failed', pr_status: 'failed', ended_at: new Date().toISOString(),
      log: lastRecord.log + message, log_size: lastRecord.log_size + Buffer.byteLength(message) });
    process.exitCode = 1;
  } finally {
    // Revoke this run's login; the VM (and its config dir) is discarded anyway.
    if (loginEnv) {
      // A code that arrived late (or after a failure) must not outlive the run.
      rmSync(SIGN_IN_CODE_DIR, { recursive: true, force: true });
      await claudeAuth(['logout'], loginEnv);
      rmSync(loginEnv.CLAUDE_CONFIG_DIR, { recursive: true, force: true });
    }
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch(() => process.exit(1));
