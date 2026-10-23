// Warm a repository's exec environment without any model run: clone (pinned
// if --ref), start a box, run the host setup recipe, and stop. Later agent
// runs of the same repository and lockfile hash then start with the
// environment already installed (per-repository env and cache volumes).
//
//   npm run build:worker
//   node scripts/warm-exec.cjs <owner/repo> [--ref <40-hex sha>]
'use strict';
const { execFileSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { prepareRepo, setupExec } = require('../.worker-build/lib/exec-run');
const { detectProfile } = require('../.worker-build/lib/contrib-profile');

async function main() {
  const repo = process.argv[2];
  const i = process.argv.indexOf('--ref');
  const ref = i > 0 ? process.argv[i + 1] : undefined;
  if (!repo) throw new Error('usage: warm-exec.cjs <owner/repo> [--ref sha]');
  let token;
  try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { token = undefined; }
  const started = Date.now();
  const checkout = await prepareRepo(repo, token, ref);
  const profile = detectProfile(checkout.dir, repo);
  const session = await setupExec(repo, `warm-${Date.now()}`, mkdtempSync(path.join(tmpdir(), 'opensrcer-warm-')), checkout, profile, (l) => process.stdout.write(l));
  if (!session) throw new Error('no exec box available');
  await session.box.stop();
  console.log(`[warm] ${repo}@${checkout.sha.slice(0, 12)} setup=${session.setup.status} in ${Math.round((Date.now() - started) / 1000)}s`);
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
