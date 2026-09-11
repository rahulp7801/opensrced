import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeRepoPath } from '../dist/safe-path.js';
import { getIndex } from '../dist/indexer.js';

test('source reads reject outside links and Git metadata; indexing ignores repository cache files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opensrcer-boundary-'));
  try {
    const repo = path.join(root, 'repo');
    const outside = path.join(root, 'outside');
    await mkdir(repo);
    await mkdir(outside);
    execFileSync('git', ['init', '--quiet', repo]);
    await writeFile(path.join(repo, 'source.ts'), 'export function safeSymbol() {}');
    await writeFile(path.join(outside, 'secret.ts'), 'export function privateSymbol() {}');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(outside, path.join(repo, 'escape'), linkType);
    await symlink(path.join(repo, '.git'), path.join(repo, 'metadata'), linkType);
    assert.equal(await safeRepoPath(repo, 'source.ts'), path.join(repo, 'source.ts'));
    for (const rel of ['../outside/secret.ts', 'escape/secret.ts', '.git/config', 'metadata/config', 'source.ts:stream']) {
      await assert.rejects(safeRepoPath(repo, rel), /repository source/);
    }
    // The old indexer trusted this file as generated state. It must neither load nor rewrite it.
    const injected = JSON.stringify({ builtAt: 1, fileCount: 1, symbols: [{ name: 'injectedSymbol' }] });
    await writeFile(path.join(repo, '.opensrcer-index.json'), injected);
    execFileSync('git', ['-C', repo, 'add', 'source.ts', '.opensrcer-index.json']);
    // Track the outside path without making Git traverse a symlink itself.
    const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: 'fixture', encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', `100644,${blob},escape/secret.ts`]);
    const index = await getIndex(repo);
    assert.ok(index.byName.has('safeSymbol'));
    assert.ok(!index.byName.has('privateSymbol'));
    assert.ok(!index.byName.has('injectedSymbol'));
    assert.equal(await readFile(path.join(repo, '.opensrcer-index.json'), 'utf8'), injected);
    assert.equal(await readFile(path.join(outside, 'secret.ts'), 'utf8'), 'export function privateSymbol() {}');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('opensrcer-boundary-'));
    await rm(root, { recursive: true, force: true });
  }
});
