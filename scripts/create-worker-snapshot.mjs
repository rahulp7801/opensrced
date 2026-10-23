// Build a credential-free worker image once per release, not per user request.
//
//   node scripts/create-worker-snapshot.mjs <full pushed sha>
//
// Dev only: `--overlay <git checkout>` starts from the pushed <sha> and writes
// the files that differ between <sha> and that checkout's HEAD (committed
// content, LF as stored) into the VM before building, so unpushed work can be
// tested hosted. Such a snapshot matches no commit: delete it after testing.
import { execFileSync } from 'node:child_process';
import { Sandbox } from '@vercel/sandbox';
const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Pass the full Git commit SHA to snapshot');
const overlayAt = process.argv.indexOf('--overlay');
const overlayDir = overlayAt > 0 ? process.argv[overlayAt + 1] : null;
if (overlayAt > 0 && !overlayDir) throw new Error('--overlay needs a git checkout directory');

/** Files changed between the pushed base and the checkout's HEAD. */
function overlayFiles(dir) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const changed = git('diff', '--name-only', '--no-renames', '-z', '--diff-filter=d', revision, 'HEAD').toString().split('\0').filter(Boolean);
  const deleted = git('diff', '--name-only', '--no-renames', '-z', '--diff-filter=D', revision, 'HEAD').toString().split('\0').filter(Boolean);
  const head = git('rev-parse', 'HEAD').toString().trim();
  return { head, deleted, files: changed.map((path) => ({ path, content: git('show', `HEAD:${path}`) })) };
}

const sandbox = await Sandbox.create({
  source: { type: 'git', url: 'https://github.com/rahulp7801/opensrced.git', revision, depth: 1 },
  timeout: 15 * 60_000, persistent: false,
});
try {
  // The universal image clones the repo to <cwd>/opensrced (cwd is /vercel);
  // the worker, its scripts and the protocol marker all live at
  // /vercel/sandbox. Link it once here so the snapshot carries the path.
  const link = await sandbox.runCommand({ cmd: 'bash', args: ['-c', 'test -e /vercel/sandbox || sudo ln -s "$PWD/opensrced" /vercel/sandbox; test -f /vercel/sandbox/package.json'] });
  if (link.exitCode !== 0) throw new Error(`repository not found at /vercel/sandbox: ${(await link.stderr()).slice(-500)}`);
  async function run(cmd, args, sudo = false) {
    const result = await sandbox.runCommand({ cmd, args, sudo, cwd: '/vercel/sandbox' });
    if (result.exitCode !== 0) throw new Error(`${cmd} failed: ${(await result.stderr()).slice(-1500)}`);
  }
  if (overlayDir) {
    const overlay = overlayFiles(overlayDir);
    console.log(`DEV OVERLAY: ${overlay.files.length} file(s) from ${overlay.head} over ${revision}; ${overlay.deleted.length} deleted. This snapshot matches no commit.`);
    await sandbox.writeFiles(overlay.files.map((f) => ({ path: `/tmp/opensrcer-overlay/${f.path}`, content: f.content })));
    const removals = overlay.deleted.map((p) => `rm -f "/vercel/sandbox/${p.replace(/"/g, '')}"`).join('; ');
    await run('bash', ['-c', `set -e; cp -r /tmp/opensrcer-overlay/. "$(readlink -f /vercel/sandbox)/"; chown -R "$(stat -c %u:%g /vercel)" "$(readlink -f /vercel/sandbox)"; rm -rf /tmp/opensrcer-overlay; ${removals || 'true'}`], true);
  }
  await run('apt-get', ['update'], true);
  // build-essential + python3-dev: target repositories' native builds in the
  // hosted exec VM (OPENSRCER_HOSTED_EXEC); same set as scripts/exec-image.Dockerfile.
  await run('apt-get', ['install', '-y', 'git', 'gh', 'patch', 'curl', 'ca-certificates', 'python3-venv', 'python3-pip', 'python3-dev', 'build-essential'], true);
  await run('python3', ['-m', 'venv', '/opt/graph'], true);
  await run('/opt/graph/bin/python', ['-m', 'pip', 'install', '--no-cache-dir', '-r', '/vercel/sandbox/requirements-graph.txt'], true);
  await run('npm', ['ci']);
  await run('npm', ['ci', '--prefix', 'mcp-server']);
  await run('npm', ['run', 'build', '--prefix', 'mcp-server']);
  await run('npm', ['run', 'build:worker']);
  await run('npm', ['install', '-g', '@anthropic-ai/claude-code@2.1.269'], true);
  // Exec VM tools the setup recipes and agents call (uv ships with the image).
  await run('npm', ['install', '-g', 'yarn@1.22.22'], true);
  await run('python3', ['-m', 'pip', 'install', '--no-cache-dir', '--break-system-packages', 'pre-commit==4.0.1'], true);
  await run('bash', ['-c', 'set -euo pipefail; cd /tmp; curl -fsSLO https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz; echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  gitleaks_8.30.1_linux_x64.tar.gz" | sha256sum -c -; tar -xzf gitleaks_8.30.1_linux_x64.tar.gz gitleaks; install gitleaks /usr/local/bin/gitleaks'], true);
  for (const cmd of ['node', 'git', 'gh', 'claude', 'gitleaks', 'yarn', 'uv', 'pre-commit', 'gcc']) await run(cmd, ['--version']);
  await run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']);
  await run('node', ['scripts/smoke-worker-tools.mjs']);
  await run('node', ['scripts/smoke-secret-gate.mjs']);
  await run('env', ['OPENSRCER_GRAPH_PYTHON=/opt/graph/bin/python', 'node', 'scripts/smoke-graph.mjs']);
  // No expiry: OPENSRCER_WORKER_SNAPSHOT_ID pins this image until the next
  // release rebuilds it, and a platform-default expiry would silently break runs.
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  console.log(`OPENSRCER_WORKER_SNAPSHOT_ID=${snapshot.snapshotId}`);
} finally {
  await sandbox.stop().catch(() => {});
}
