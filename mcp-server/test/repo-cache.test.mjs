import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('repository tools enforce scope and pin separate caches to PR revisions', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opensrcer-mcp-'));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const keys = ['OPENSRCER_CACHE_DIR', 'OPENSRCER_ALLOWED_REPO', 'OPENSRCER_REPO_REF'];
  const previous = keys.map(key => process.env[key]);
  const originalExecFile = childProcess.execFile;
  childProcess.execFile = (cmd, args, options, callback) => {
    calls.push({ cmd, args, options });
    const clone = args.includes('clone');
    Promise.resolve(clone ? mkdir(path.join(args.at(-1), '.git'), { recursive: true }) : undefined)
      .then(() => callback(null, '', ''), callback);
  };
  syncBuiltinESMExports();
  try {
    const { parseRepo, ensureRepo } = await import('../dist/repo-cache.js');
    for (const repo of ['../secret', 'owner/..', 'owner/repo\\..\\secret', 'https://other.example/owner/repo', 123]) assert.throws(() => parseRepo(repo));
    process.env.OPENSRCER_CACHE_DIR = root;
    process.env.OPENSRCER_ALLOWED_REPO = 'owner/repo';
    process.env.OPENSRCER_REPO_REF = 'a'.repeat(40);
    await assert.rejects(ensureRepo('other/private'), /only read/);
    assert.equal(calls.length, 0);
    const first = await ensureRepo('owner/repo');
    assert.ok(calls.some(call => call.args.includes('fetch') && call.args.at(-1) === 'a'.repeat(40)));
    assert.ok(calls.some(call => call.args.includes('checkout') && call.args.at(-1) === 'a'.repeat(40)));
    process.env.OPENSRCER_REPO_REF = 'b'.repeat(40);
    const second = await ensureRepo('owner/repo');
    assert.notEqual(first.dir, second.dir);
    assert.ok(!path.relative(root, first.dir).startsWith('..'));
    process.env.OPENSRCER_REPO_REF = '--upload-pack=evil';
    await assert.rejects(ensureRepo('owner/repo'), /Invalid pinned revision/);
    assert.ok(calls.every(call => call.options.timeout > 0));
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test('clones are long-path safe and go partial + sparse only for listed directories', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'opensrcer-mcp-sparse-'));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const keys = ['OPENSRCER_CACHE_DIR', 'OPENSRCER_ALLOWED_REPO', 'OPENSRCER_REPO_REF', 'OPENSRCER_CLONE_SPARSE', 'OPENSRCER_CLONE_TIMEOUT_MS'];
  const previous = keys.map(key => process.env[key]);
  const originalExecFile = childProcess.execFile;
  childProcess.execFile = (cmd, args, options, callback) => {
    calls.push({ cmd, args, options });
    const clone = args.includes('clone');
    Promise.resolve(clone ? mkdir(path.join(args.at(-1), '.git'), { recursive: true }) : undefined)
      .then(() => callback(null, '', ''), callback);
  };
  syncBuiltinESMExports();
  try {
    // A fresh module instance: the first test's instance captured its own execFile mock.
    const { ensureRepo, sparseDirs } = await import('../dist/repo-cache.js?sparse');
    process.env.OPENSRCER_CACHE_DIR = root;
    delete process.env.OPENSRCER_REPO_REF;
    process.env.OPENSRCER_ALLOWED_REPO = 'pytorch/pytorch';
    process.env.OPENSRCER_CLONE_SPARSE = 'torch test .github ../escape /abs --bad';
    process.env.OPENSRCER_CLONE_TIMEOUT_MS = '123456';
    assert.deepEqual(sparseDirs(), ['torch', 'test', '.github']);
    await ensureRepo('pytorch/pytorch');
    const clone = calls.find(call => call.args.includes('clone'));
    assert.ok(clone.args.includes('core.longpaths=true'));
    assert.ok(clone.args.includes('--filter=blob:none') && clone.args.includes('--sparse'));
    assert.equal(clone.options.timeout, 123456);
    const sparse = calls.find(call => call.args.includes('sparse-checkout'));
    assert.deepEqual(sparse.args.slice(sparse.args.indexOf('--') + 1), ['torch', 'test', '.github']);
    delete process.env.OPENSRCER_CLONE_SPARSE;
    assert.deepEqual(sparseDirs(), []);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
