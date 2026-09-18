// Exercise the actual worker scanner and pinned Gitleaks, without live secrets.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSecrets } from '../.worker-build/lib/gitleaks-scanner.js';

const root = await mkdtemp(join(tmpdir(), 'opensrcer-secret-gate-'));
const repo = join(root, 'repo');
const credential = 'gh' + 'p_' + 'K8xP7az9W4hV2yq5J3dR6Nc0F1mS8bQ4tZ9u';
try {
  await mkdir(repo);
  await writeFile(join(repo, 'file.txt'), 'const token = process.env.GITHUB_TOKEN;\n');
  assert.equal((await scanSecrets(root)).status, 'clean', 'ordinary source must pass');

  // A clean checkout can still have a credential in deleted/context patch lines.
  await writeFile(join(root, 'fix.patch'), `--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-token = "${credential}"\n+token = process.env.GITHUB_TOKEN\n`);
  const deletion = await scanSecrets(root);
  assert.equal(deletion.status, 'leaks_found', 'raw patch deletions must be scanned');
  assert.ok(!JSON.stringify(deletion).includes(credential), 'scanner results must redact credential values');
  await rm(join(root, 'fix.patch'));

  // Target-owned suppression mechanisms must not weaken the application's gate.
  await writeFile(join(repo, 'leak.txt'), `token = "${credential}" // gitleaks:allow\n`);
  const finding = await scanSecrets(root);
  assert.equal(finding.status, 'leaks_found', 'inline allow comments must not bypass scanning');
  await writeFile(join(repo, '.gitleaksignore'), finding.findings.map(item => item.fingerprint).join('\n'));
  await writeFile(join(repo, '.gitleaks.toml'), '[extend]\nuseDefault = true\n[allowlist]\nregexes = [".*"]\n');
  assert.equal((await scanSecrets(root)).status, 'leaks_found', 'target config and ignore files must not bypass scanning');
  await writeFile(join(root, '.gitleaks.toml'), '[extend]\nuseDefault = true\n[allowlist]\nregexes = [".*"]\n');
  assert.equal((await scanSecrets(root)).status, 'leaks_found', 'trusted rule selection must override source config');
  console.log(JSON.stringify({ cleanSource: true, deletedCredentialBlocked: true, targetSuppressionsBlocked: true }));
} finally {
  // Concrete mkdtemp result; no target-repository or client path is used.
  await rm(root, { recursive: true, force: true });
}
