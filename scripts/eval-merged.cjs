// SWE-bench-style evaluation against an issue a human already fixed.
//
//   npm run build:worker
//   node scripts/eval-merged.cjs <owner/repo> <merged PR #> [--issue N] [--provider claude-subscription|anthropic-key] [--budget USD]
//
// Pins the checkout to the commit before the human fix (OPENSRCER_REPO_REF),
// runs the agent as a DRY RUN on the linked issue, then inside the agent's
// own exec box: applies ONLY the human PR's test changes on top of our patch
// and runs them (a) with our patch and (b) with our source change reverted.
// "Human tests fail without our patch and pass with it" is the closest
// signal we have tonight to "this would have been mergeable".
//
// Eval mode only: this is the one caller that sets allowClosedIssue. The web
// flow still refuses closed issues. Nothing is pushed, posted or opened.
// Reads use your gh CLI token (GitHub API + clone); it never reaches the box.

'use strict';
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { startAgenticDispatch } = require('../.worker-build/lib/agentic-dispatcher');
const store = require('../.worker-build/lib/dispatch-store');
const { githubApi } = require('../.worker-build/lib/github-api');
const { boxRequest, runInBox } = require('../.worker-build/lib/exec-box');
const { failBeforeScript, isTestPath } = require('../.worker-build/lib/verify');
const { diffTouchedFiles } = require('../.worker-build/lib/apply-diff');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Keep only the file sections of a unified diff whose path is a test. */
function testSections(diff) {
  return diff.split(/(?=^diff --git )/m).filter((s) => {
    const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(s);
    return m && isTestPath(m[2]);
  }).join('');
}

function testCommand(repo, files) {
  const quoted = files.map((f) => `'${f.replace(/'/g, `'\\''`)}'`).join(' ');
  if (/\.(py)$/.test(files[0] ?? '')) {
    // The host setup's venv first (~/env/venv), then ones an agent may have made.
    return `PY=python3; [ -x ~/venv/bin/python ] && PY=~/venv/bin/python; [ -x .venv/bin/python ] && PY=.venv/bin/python; [ -x ~/env/venv/bin/python ] && PY=~/env/venv/bin/python; $PY -m pytest ${quoted} -q -p no:cacheprovider`;
  }
  return `yarn test --silent --no-watchman ${quoted}`;
}

async function main() {
  const [repo, prArg] = process.argv.slice(2);
  if (!repo || !/^\d+$/.test(prArg ?? '')) throw new Error('usage: eval-merged.cjs <owner/repo> <merged PR #> [--issue N] [--budget USD]');
  // --provider claude-subscription (default): the local claude CLI login, no key.
  // --provider anthropic-key: ANTHROPIC_KEY / ANTHROPIC_API_KEY from the env.
  const provider = arg('--provider') ?? 'claude-subscription';
  const anthropicKey = provider === 'anthropic-key' ? (process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY) : undefined;
  if (provider === 'anthropic-key' && !anthropicKey) throw new Error('set ANTHROPIC_KEY (node --env-file=.env.local)');
  // Caps for plan-billed runs: turns and wall clock (overridable by env).
  process.env.OPENSRCER_AGENTIC_EXEC_MAX_TURNS ??= '60';
  process.env.OPENSRCER_AGENTIC_TIMEOUT_MS ??= String(20 * 60_000);
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

  const pr = await githubApi(`/repos/${repo}/pulls/${prArg}`, token);
  if (!pr.merged_at) throw new Error(`PR #${prArg} is not merged`);
  const merge = await githubApi(`/repos/${repo}/commits/${pr.merge_commit_sha}`, token);
  const baseSha = merge.parents[0].sha;
  let issue = Number(arg('--issue'));
  if (!issue) {
    const q = `query { repository(owner: "${repo.split('/')[0]}", name: "${repo.split('/')[1]}") { pullRequest(number: ${prArg}) { closingIssuesReferences(first: 5) { nodes { number } } } } }`;
    const out = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`], { encoding: 'utf8' }));
    issue = out.data.repository.pullRequest.closingIssuesReferences.nodes[0]?.number
      ?? Number(/(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/|#)(\d+)/i.exec(pr.body ?? '')?.[1]);
  }
  if (!issue) throw new Error('could not find the issue this PR closes; pass --issue N');
  const humanDiff = execFileSync('gh', ['pr', 'diff', prArg, '--repo', repo], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const humanTests = testSections(humanDiff);
  const humanTestFiles = diffTouchedFiles(humanTests);
  console.log(`[eval] ${repo}#${issue} (human fix: PR #${prArg} "${pr.title}"), base ${baseSha}`);
  console.log(`[eval] human PR files: ${diffTouchedFiles(humanDiff).join(', ')}; tests: ${humanTestFiles.join(', ') || 'none'}`);

  const evalResult = { repo, issue, human_pr: Number(prArg), base_sha: baseSha, human_test_files: humanTestFiles };
  const evalHook = async (box, ourPatch) => {
    const ourFiles = diffTouchedFiles(ourPatch);
    evalResult.our_files = ourFiles;
    evalResult.human_files = diffTouchedFiles(humanDiff);
    if (!humanTests) { evalResult.human_tests = 'none in the human PR'; return; }
    await boxRequest(box, 'POST', '/write', { path: '.opensrcer/human-tests.patch', content: humanTests });
    const apply = await runInBox(box, 'git apply --3way .opensrcer/human-tests.patch || git apply --reject .opensrcer/human-tests.patch', 120000, true);
    evalResult.human_tests_applied = apply.exit_code === 0;
    const cmd = testCommand(repo, humanTestFiles);
    const withOurs = await runInBox(box, cmd, undefined, true);
    const ourSource = ourFiles.filter((f) => !isTestPath(f));
    const without = ourSource.length ? await runInBox(box, failBeforeScript(ourSource, [cmd]), undefined, true) : null;
    evalResult.human_test_command = cmd;
    evalResult.with_our_patch = { exit_code: withOurs.exit_code, timed_out: withOurs.timed_out, tail: withOurs.output.slice(-1500) };
    evalResult.without_our_patch = without && { exit_code: without.exit_code, timed_out: without.timed_out, tail: without.output.slice(-1500) };
  };

  // --reeval <dispatch id>: no model. Re-run only the human-test check against
  // a stored patch, in a fresh box with the host-prepared environment.
  const reeval = arg('--reeval');
  if (reeval) {
    if (!/^d_[\w-]+$/.test(reeval)) throw new Error('--reeval takes a dispatch id');
    const { prepareRepo, setupExec } = require('../.worker-build/lib/exec-run');
    const { detectProfile } = require('../.worker-build/lib/contrib-profile');
    const ourPatch = readFileSync(path.join('.dispatches', reeval, 'final.patch'), 'utf8');
    const checkout = await prepareRepo(repo, token, baseSha);
    const session = await setupExec(repo, `${reeval}-reeval`, path.join('.dispatches', reeval, 'reeval'), checkout, detectProfile(checkout.dir, repo), (l) => process.stdout.write(l));
    if (!session) throw new Error('no exec box');
    try {
      await boxRequest(session.box, 'POST', '/write', { path: '.opensrcer/ours.patch', content: ourPatch });
      const applied = await runInBox(session.box, 'git apply .opensrcer/ours.patch', 120000, true);
      if (applied.exit_code !== 0) throw new Error(`our patch did not apply: ${applied.output.slice(-500)}`);
      await evalHook(session.box, ourPatch);
    } finally {
      await session.box.stop();
    }
    Object.assign(evalResult, { dispatch: reeval, mode: 'reeval (no model)',
      human_tests_pass_with_ours: evalResult.with_our_patch ? evalResult.with_our_patch.exit_code === 0 : null,
      human_tests_fail_without_ours: evalResult.without_our_patch ? evalResult.without_our_patch.exit_code !== 0 : null });
    writeFileSync(path.join('.dispatches', reeval, 'eval-reeval.json'), JSON.stringify(evalResult, null, 1));
    console.log(JSON.stringify(evalResult, null, 1));
    return;
  }

  const started = Date.now();
  const d = await startAgenticDispatch(`https://github.com/${repo}`, issue, {
    dryRun: true, repoRef: baseSha, allowClosedIssue: true, provider, anthropicKey, token, evalHook,
    auth0UserId: 'local-eval', maxSpendUsd: arg('--budget') ? Number(arg('--budget')) : undefined,
  });
  console.log(`[eval] dispatch ${d.id}, log ${d.log_path}`);
  let printed = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    if (existsSync(d.log_path)) {
      const text = readFileSync(d.log_path, 'utf8');
      process.stdout.write(text.slice(printed).split('\n').filter((l) => /^\[(exec|profile|guard|verify|preview|tool|triage|agentic-dispatcher)\]/.test(l)).map((l) => l.slice(0, 200) + '\n').join(''));
      printed = text.length;
    }
    const rec = store.read(d.id);
    if (rec && rec.status !== 'running') break;
  }
  const log = readFileSync(d.log_path, 'utf8');
  const cost = Number(/total_cost_usd=([\d.]+)/.exec(log)?.[1] ?? NaN);
  const verification = existsSync(path.join('.dispatches', d.id, 'verification.json')) ? JSON.parse(readFileSync(path.join('.dispatches', d.id, 'verification.json'), 'utf8')) : null;
  Object.assign(evalResult, {
    dispatch: d.id, status: store.read(d.id)?.status, cost_usd: cost, duration_s: Math.round((Date.now() - started) / 1000),
    verification: verification && { status: verification.status, reason: verification.reason, regression: verification.regression, plan: verification.plan },
    human_tests_pass_with_ours: evalResult.with_our_patch ? evalResult.with_our_patch.exit_code === 0 : null,
    human_tests_fail_without_ours: evalResult.without_our_patch ? evalResult.without_our_patch.exit_code !== 0 : null,
  });
  writeFileSync(path.join('.dispatches', d.id, 'eval.json'), JSON.stringify(evalResult, null, 1));
  console.log(JSON.stringify(evalResult, null, 1));
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
