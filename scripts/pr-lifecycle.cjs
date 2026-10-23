// PR lifecycle poller (lib/pr-lifecycle.ts). One pass per invocation; run it
// from cron / a scheduler, or by hand.
//
//   npm run build:worker
//   node scripts/pr-lifecycle.cjs owner/repo#12 [owner/repo#13 ...]   poll these PRs
//   node scripts/pr-lifecycle.cjs --all                                 every PR opensrcer opened (local runs)
//   node scripts/pr-lifecycle.cjs owner/repo#12 --followups on|off      per-PR opt-in
//   ... --act                                                           act on events for opted-in PRs
//
// Read-only on GitHub unless --act is passed AND the PR is opted in. Even
// then it never comments: review replies stay drafts on the PR page. With
// --act: CI failures and change requests start a follow-up agent run pinned
// to the PR head (a preview, verified in the exec box) whose patch is pushed
// to the PR branch only if verification did not fail; merge conflicts are
// rebased onto the base branch and force-pushed with lease.
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const lc = require('../.worker-build/lib/pr-lifecycle');
const store = require('../.worker-build/lib/dispatch-store');

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { return undefined; }
}

function parseRef(s) {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s) || /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(s);
  if (!m) throw new Error(`not a PR reference: ${s}`);
  return { repo: m[1], number: Number(m[2]) };
}

async function act(pr, events, state, snapshot, tok) {
  const actionable = events.filter((e) => e.kind === 'ci_failed' || (e.kind === 'comment' && (e.changes_requested || e.path)));
  if (events.some((e) => e.kind === 'conflict')) {
    const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: tok } }).trim();
    const r = await lc.rebaseBranch({ headUrl: `https://github.com/${snapshot.head_repo}.git`, branch: snapshot.head_ref, baseUrl: `https://github.com/${pr.repo}.git`, baseRef: snapshot.base_ref, token: tok, author: { name: login, email: `${login}@users.noreply.github.com` } });
    console.log(`  rebase: ${r.ok ? `pushed ${r.sha.slice(0, 12)}` : r.reason}`);
  }
  const task = lc.followupTask(actionable);
  if (!task) return;
  const { startAgenticDispatch } = require('../.worker-build/lib/agentic-dispatcher');
  const { pushPrPatch } = require('../.worker-build/lib/pr-push');
  const { readPreview } = require('../.worker-build/lib/pr-preview');
  const issue = lc.linkedIssue(snapshot.body ?? '');
  if (!issue) { console.log('  follow-up: the PR body names no issue; skipped'); return; }
  const d = await startAgenticDispatch(`https://github.com/${pr.repo}`, issue, {
    dryRun: true, repoRef: snapshot.head_sha, allowClosedIssue: true, token: tok, auth0UserId: 'local-lifecycle',
    notes: `You are updating your own open pull request #${pr.number} (its changes are already in the checkout).\n${task}`,
  });
  console.log(`  follow-up run ${d.id}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const rec = store.read(d.id);
    if (rec && rec.status !== 'running') break;
  }
  const stored = await readPreview(path.join('.dispatches', d.id));
  if (!stored || stored.preview.verification?.status === 'failed') { console.log('  follow-up: no verified patch; nothing pushed'); return; }
  const r = await pushPrPatch({ repo: snapshot.head_repo, branch: snapshot.head_ref, diff: stored.diff, commit_message: stored.preview.commit_message }, tok);
  console.log(`  follow-up: ${r.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  const tok = token();
  let refs = args.filter((a) => /#\d+$|\/pull\/\d+/.test(a)).map(parseRef);
  if (args.includes('--all')) {
    refs = store.listAll().filter((r) => r.pr_url).map((r) => parseRef(r.pr_url));
  }
  const toggle = args[args.indexOf('--followups') + 1];
  for (const pr of refs) {
    if (args.includes('--followups')) {
      const s = await lc.setFollowups(pr, toggle === 'on');
      console.log(`${pr.repo}#${pr.number}: follow-ups ${s.followups ? 'ON' : 'off'}`);
      continue;
    }
    const { events, state, snapshot } = await lc.pollOnce(pr, tok);
    console.log(`${pr.repo}#${pr.number}: ${snapshot.state}${snapshot.merged ? ' (merged)' : ''} head=${snapshot.head_sha.slice(0, 12)} ci=${lc.ciVerdict(snapshot.checks)} mergeable=${snapshot.mergeable_state} follow-ups=${state.followups ? 'on' : 'off'}`);
    for (const e of events) {
      const detail = e.kind === 'ci_failed' ? e.checks.map((c) => c.name).join(', ') : e.kind === 'comment' ? `${e.author}${e.changes_requested ? ' (changes requested)' : ''}: ${e.body.replace(/\s+/g, ' ').slice(0, 120)}` : '';
      console.log(`  event ${e.kind} ${detail}`);
    }
    if (state.pending_replies.length) console.log(`  ${state.pending_replies.length} comment(s) awaiting a drafted reply on the PR page (never auto-posted)`);
    if (args.includes('--act') && state.followups && events.length) await act(pr, events, state, snapshot, tok);
    else if (args.includes('--act') && events.length) console.log('  --act ignored: follow-ups are off for this PR (opt in with --followups on)');
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
