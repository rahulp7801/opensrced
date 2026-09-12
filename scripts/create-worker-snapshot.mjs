// Build a credential-free worker image once per release, not per user request.
import { Sandbox } from '@vercel/sandbox';
const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Pass the full Git commit SHA to snapshot');
const sandbox = await Sandbox.create({
  source: { type: 'git', url: 'https://github.com/rahulp7801/opensrced.git', revision, depth: 1 },
  timeout: 15 * 60_000, persistent: false,
});
try {
  async function run(cmd, args, sudo = false) {
    const result = await sandbox.runCommand({ cmd, args, sudo, cwd: '/vercel/sandbox' });
    if (result.exitCode !== 0) throw new Error(`${cmd} failed: ${(await result.stderr()).slice(-1500)}`);
  }
  await run('apt-get', ['update'], true);
  await run('apt-get', ['install', '-y', 'git', 'gh', 'patch', 'curl', 'ca-certificates', 'python3-venv'], true);
  await run('python3', ['-m', 'venv', '/opt/graph'], true);
  await run('/opt/graph/bin/python', ['-m', 'pip', 'install', '--no-cache-dir', '-r', '/vercel/sandbox/requirements-graph.txt'], true);
  await run('npm', ['ci', '--legacy-peer-deps']);
  await run('npm', ['ci', '--prefix', 'mcp-server']);
  await run('npm', ['run', 'build', '--prefix', 'mcp-server']);
  await run('npm', ['run', 'build:worker']);
  await run('npm', ['install', '-g', '@anthropic-ai/claude-code@2.1.269'], true);
  await run('bash', ['-c', 'set -euo pipefail; cd /tmp; curl -fsSLO https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz; curl -fsSLO https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt; grep "gitleaks_8.30.1_linux_x64.tar.gz$" gitleaks_8.30.1_checksums.txt | sha256sum -c -; tar -xzf gitleaks_8.30.1_linux_x64.tar.gz gitleaks; install gitleaks /usr/local/bin/gitleaks'], true);
  for (const cmd of ['node', 'git', 'gh', 'claude', 'gitleaks']) await run(cmd, ['--version']);
  await run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']);
  await run('node', ['scripts/smoke-worker-tools.mjs']);
  await run('env', ['OPENSRCER_GRAPH_PYTHON=/opt/graph/bin/python', 'node', 'scripts/smoke-graph.mjs']);
  const snapshot = await sandbox.snapshot();
  console.log(`OPENSRCER_WORKER_SNAPSHOT_ID=${snapshot.snapshotId}`);
} finally {
  await sandbox.stop().catch(() => {});
}
