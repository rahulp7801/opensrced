// End-to-end dispatch on a real repository and issue, without publishing:
//
//   npm run build:worker
//   node scripts/smoke-dispatch.cjs <owner/repo> <issue> [--live] [--plan file.json] [--provider claude-subscription|anthropic-key]
//
// --plan swaps the model for scripts/smoke-exec-agent.mjs replaying the
// given tool calls (no spend). --live runs as a live (not dry) run, so the
// run ends at the publish gate ("awaiting_review"); this script then checks
// the gate refuses without confirmation and STOPS there. Nothing is pushed,
// posted or opened, ever.
'use strict';
const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync, readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [repo, issueArg] = process.argv.slice(2);
  if (!repo || !/^\d+$/.test(issueArg ?? '')) throw new Error('usage: smoke-dispatch.cjs <owner/repo> <issue> [--live] [--plan file]');
  const plan = arg('--plan');
  if (plan) {
    mkdirSync('.dispatches', { recursive: true });
    copyFileSync(plan, path.join('.dispatches', 'smoke-plan.json'));
    process.env.OPENSRCER_AGENT_BIN = process.execPath;
    process.env.OPENSRCER_AGENT_ARGS = path.resolve('scripts', 'smoke-exec-agent.mjs');
    process.env.OPENSRCER_TRIAGE = '0';
  }
  process.env.OPENSRCER_AGENTIC_EXEC_MAX_TURNS ??= '60';
  process.env.OPENSRCER_AGENTIC_TIMEOUT_MS ??= String(20 * 60_000);
  const { startAgenticDispatch } = require('../.worker-build/lib/agentic-dispatcher');
  const store = require('../.worker-build/lib/dispatch-store');
  const { checkPublishable } = require('../.worker-build/lib/publish');
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  const live = process.argv.includes('--live');
  const d = await startAgenticDispatch(`https://github.com/${repo}`, Number(issueArg), {
    dryRun: !live, token, auth0UserId: 'local-smoke', author: { login, id: 1 },
    provider: arg('--provider') ?? 'claude-subscription',
  });
  console.log(`[smoke] dispatch ${d.id} (${live ? 'live: stops at the publish gate' : 'dry run'})`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const rec = store.read(d.id);
    if (rec && rec.status !== 'running') break;
  }
  const rec = store.read(d.id);
  console.log(readFileSync(d.log_path, 'utf8').split('\n').filter((l) => /^\[(exec|profile|guard|triage|verify|preview|agentic-dispatcher\] (exited|tokens|total))/.test(l)).join('\n'));
  console.log(`[smoke] status=${rec.status} pr_status=${rec.pr_status} tests=${rec.tests}`);
  if (live && rec.pr_status === 'blocked') {
    // Stand-in (--plan) runs always land here: their previews carry a blocker.
    try { await checkPublishable({ id: d.id, viewerId: 'local-smoke', confirmed: true }); console.log('[smoke] GATE FAILED: a blocked preview was publishable'); }
    catch (e) { console.log(`[smoke] gate on a blocked preview -> ${e.status}: ${e.message}`); }
  }
  if (live && rec.pr_status === 'awaiting_review') {
    try { await checkPublishable({ id: d.id, viewerId: 'local-smoke', confirmed: undefined }); console.log('[smoke] GATE FAILED: published without confirmation'); }
    catch (e) { console.log(`[smoke] gate without confirmation -> ${e.status}: ${e.message}`); }
    const ok = await checkPublishable({ id: d.id, viewerId: 'local-smoke', confirmed: true });
    console.log(`[smoke] gate with confirmation -> publishable (${ok.stored.preview.files.join(', ')}); NOT publishing (smoke run)`);
    const preview = path.join('.dispatches', d.id, 'preview.json');
    if (existsSync(preview)) console.log(`[smoke] preview body:\n${JSON.parse(readFileSync(preview, 'utf8')).body}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
